import server.models as models
from server.models import all_models, download, get_model, is_downloaded


def test_registry_has_recommended_stt_and_tts():
    specs = all_models()
    assert {s.kind for s in specs} == {"stt", "tts"}
    assert any(s.recommended for s in specs if s.kind == "stt")
    assert any(s.recommended for s in specs if s.kind == "tts")


def test_get_model_lookup():
    assert get_model("stt", "cohere-transcribe").recommended is True
    assert get_model("stt", "parakeet-unified-en").recommended is False
    assert get_model("tts", "kokoro").kind == "tts"
    assert get_model("stt", "does-not-exist") is None


def test_every_stt_model_downloads_a_single_gguf():
    for spec in models.STT_MODELS:
        assert len(spec.files) == 1
        assert spec.files[0].endswith(".gguf")


def test_is_downloaded_checks_local_files(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    cohere = get_model("stt", "cohere-transcribe")
    assert is_downloaded(cohere) is False
    (tmp_path / "stt" / "cohere-transcribe").mkdir(parents=True)
    (tmp_path / "stt" / "cohere-transcribe" / "q4.gguf").write_bytes(b"x")
    assert is_downloaded(cohere) is True
    assert is_downloaded(get_model("stt", "parakeet-unified-en")) is False

    (tmp_path / "tts").mkdir()
    assert is_downloaded(get_model("tts", "kokoro")) is False
    (tmp_path / "tts" / "kokoro-v1_0.pth").write_bytes(b"x")
    assert is_downloaded(get_model("tts", "kokoro")) is True


def test_download_fetches_only_listed_gguf_file(monkeypatch):
    files = []

    def fake_hf(repo_id, filename, local_dir, tqdm_class=None):
        files.append((repo_id, filename, local_dir, tqdm_class))

    monkeypatch.setattr(models, "hf_hub_download", fake_hf)
    download(get_model("stt", "cohere-transcribe"))
    assert len(files) == 1
    repo, filename, local_dir, tqdm_class = files[0]
    assert repo == "handy-computer/cohere-transcribe-03-2026-gguf"
    assert filename.endswith("Q4_K_M.gguf")
    assert local_dir.endswith("models/stt/cohere-transcribe")
    assert tqdm_class is None  # no callback => real progress bar


def test_download_tts_calls_hf_hub_download(monkeypatch):
    files = []

    def fake_hf(repo_id, filename, local_dir, tqdm_class=None):
        files.append((repo_id, filename))

    monkeypatch.setattr(models, "hf_hub_download", fake_hf)
    download(get_model("tts", "kokoro"))
    filenames = [f for _, f in files]
    assert "kokoro-v1_0.pth" in filenames
    assert "config.json" in filenames
    assert any(f.startswith("voices/") for f in filenames)


def test_download_maps_gated_repo_to_actionable_error(monkeypatch):
    def gated(repo_id, filename, local_dir, tqdm_class=None):
        raise RuntimeError("403 Client Error. Cannot access gated repo for url ...")

    monkeypatch.setattr(models, "hf_hub_download", gated)
    import pytest

    with pytest.raises(RuntimeError, match="huggingface.co/handy-computer"):
        download(get_model("stt", "cohere-transcribe"))


async def test_manager_status_and_run(monkeypatch, tmp_path):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    manager = models.ModelManager()
    spec = get_model("stt", "cohere-transcribe")
    assert manager.status(spec)["state"] == "not_downloaded"

    def fake_download(spec, on_update=None):
        target = tmp_path / "stt" / spec.id
        target.mkdir(parents=True, exist_ok=True)
        (target / "model.gguf").write_bytes(b"x")
        if on_update:
            on_update(100, 100)

    monkeypatch.setattr(models, "download", fake_download)
    await manager._run(spec)
    assert manager.status(spec)["state"] == "downloaded"


def test_models_route_marks_configured_stt_active():
    from fastapi.testclient import TestClient

    from sidecar.app import create_sidecar_app

    app = create_sidecar_app(None, None, openai_stt_model="cohere-transcribe")
    client = TestClient(app)
    by_id = {
        (m["kind"], m["id"]): m
        for m in client.get("/api/models").json()["models"]
    }
    assert by_id[("stt", "cohere-transcribe")]["active"] is True
    assert by_id[("stt", "parakeet-unified-en")]["active"] is False
    assert by_id[("tts", "kokoro")]["active"] is True


def _select_app(monkeypatch, tmp_path, factory=None, persist=None):
    from sidecar.app import create_sidecar_app

    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    (tmp_path / "stt" / "parakeet-unified-en").mkdir(parents=True)
    (tmp_path / "stt" / "parakeet-unified-en" / "model.gguf").write_bytes(b"x")
    return create_sidecar_app(
        None, None, openai_stt_model="cohere-transcribe",
        stt_factory=factory, persist_stt=persist,
    )


def test_select_stt_swaps_engine_and_persists(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    loaded, persisted = [], []
    app = _select_app(
        monkeypatch, tmp_path,
        factory=lambda mid: loaded.append(mid) or f"engine:{mid}",
        persist=persisted.append,
    )
    client = TestClient(app)

    resp = client.post("/api/models/stt/parakeet-unified-en/select")
    assert resp.status_code == 200
    assert resp.json()["active"] == "parakeet-unified-en"
    assert loaded == ["parakeet-unified-en"]
    assert persisted == ["parakeet-unified-en"]

    by_id = {m["id"]: m for m in client.get("/api/models").json()["models"]}
    assert by_id["parakeet-unified-en"]["active"] is True
    assert by_id["cohere-transcribe"]["active"] is False

    # Selecting the already-active model doesn't reload it.
    assert client.post("/api/models/stt/parakeet-unified-en/select").status_code == 200
    assert loaded == ["parakeet-unified-en"]


def test_select_rejects_bad_requests(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    app = _select_app(monkeypatch, tmp_path, factory=lambda mid: mid)
    client = TestClient(app)

    assert client.post("/api/models/stt/nope/select").status_code == 404
    assert client.post("/api/models/tts/kokoro/select").status_code == 501  # no TTS factory wired
    assert client.post("/api/models/stt/canary-180m-flash/select").status_code == 409  # not downloaded


def test_select_disabled_without_factory(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    app = _select_app(monkeypatch, tmp_path)
    client = TestClient(app)
    assert client.post("/api/models/stt/parakeet-unified-en/select").status_code == 501


def _fake_download(root, spec):
    folder = root / "tts" / spec.id
    folder.mkdir(parents=True, exist_ok=True)
    for f in spec.files:
        (folder / f).write_bytes(b"x")


def test_registry_includes_chatterbox_turbo_and_nano():
    turbo = get_model("tts", "chatterbox-turbo")
    nano = get_model("tts", "chatterbox-nano")
    assert turbo and nano
    assert "t3_turbo_v1.safetensors" in turbo.files and "t3_nano_v1.safetensors" in nano.files
    for spec in (turbo, nano):
        assert "s3gen_meanflow.safetensors" in spec.files
        assert "conds.pt" in spec.files and "ve.safetensors" in spec.files
        assert "s3gen.safetensors" not in spec.files, "the legacy decoder is never loaded"
        assert spec.size_mb > 1000
    assert nano.size_mb < turbo.size_mb


def test_is_downloaded_chatterbox_checks_its_own_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    nano = get_model("tts", "chatterbox-nano")
    assert is_downloaded(nano) is False
    (tmp_path / "tts" / "chatterbox-nano").mkdir(parents=True)
    (tmp_path / "tts" / "chatterbox-nano" / "t3_nano_v1.safetensors").write_bytes(b"x")
    (tmp_path / "tts" / "chatterbox-nano" / "s3gen_meanflow.safetensors").write_bytes(b"x")
    assert is_downloaded(nano) is False, "a partial download is not downloaded"
    _fake_download(tmp_path, nano)
    assert is_downloaded(nano) is True
    assert is_downloaded(get_model("tts", "chatterbox-turbo")) is False
    assert is_downloaded(get_model("tts", "kokoro")) is False


def test_download_chatterbox_targets_its_own_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    targets = []

    def fake_hf(repo_id, filename, local_dir, **kw):
        targets.append((repo_id, filename, local_dir))

    monkeypatch.setattr(models, "hf_hub_download", fake_hf)
    download(get_model("tts", "chatterbox-turbo"))
    assert all(t[0] == "ResembleAI/chatterbox-turbo" for t in targets)
    assert all(t[2].endswith("tts/chatterbox-turbo") for t in targets)
    download(get_model("tts", "kokoro"))
    assert targets[-1][2].endswith("tts")


def _tts_select_app(monkeypatch, tmp_path, factory=None, persist=None):
    from sidecar.app import create_sidecar_app

    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    _fake_download(tmp_path, get_model("tts", "chatterbox-nano"))

    class Engine:
        def __init__(self, name):
            self.name = name
        def voices(self):
            return ["default", "alice"] if self.name.startswith("chatterbox") else ["af_heart", "am_adam"]
        @property
        def default_voice(self):
            return self.voices()[0]

    return create_sidecar_app(
        None, Engine("kokoro"), tts_model="kokoro",
        tts_factory=(lambda mid: factory(mid) or Engine(mid)) if factory else None, persist_tts=persist,
    )


def test_select_tts_swaps_engine_persists_and_updates_voices(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    loaded, persisted = [], []
    app = _tts_select_app(monkeypatch, tmp_path, factory=loaded.append, persist=persisted.append)
    client = TestClient(app)
    assert client.get("/api/voices").json() == {"engine": "kokoro", "voices": ["af_heart", "am_adam"], "default": "af_heart"}

    resp = client.post("/api/models/tts/chatterbox-nano/select")
    assert resp.status_code == 200, resp.text
    assert resp.json()["active"] == "chatterbox-nano"
    assert loaded == ["chatterbox-nano"] and persisted == ["chatterbox-nano"]
    by_id = {m["id"]: m for m in client.get("/api/models").json()["models"] if m["kind"] == "tts"}
    assert by_id["chatterbox-nano"]["active"] is True and by_id["kokoro"]["active"] is False
    assert by_id["chatterbox-nano"]["selectable"] is False and by_id["kokoro"]["selectable"] is False  # kokoro not downloaded here
    assert client.get("/api/voices").json() == {"engine": "chatterbox-nano", "voices": ["default", "alice"], "default": "default"}
    assert client.post("/api/models/tts/chatterbox-turbo/select").status_code == 409  # not downloaded


def test_select_tts_reports_missing_package_clearly(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    def broken(mid):
        raise ImportError("No module named 'chatterbox'")

    app = _tts_select_app(monkeypatch, tmp_path, factory=broken)
    client = TestClient(app)
    resp = client.post("/api/models/tts/chatterbox-nano/select")
    assert resp.status_code == 501
    assert "chatterbox" in resp.json()["detail"]
