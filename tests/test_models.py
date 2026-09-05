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
    assert client.post("/api/models/tts/kokoro/select").status_code == 400
    assert client.post("/api/models/stt/canary-180m-flash/select").status_code == 409  # not downloaded


def test_select_disabled_without_factory(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    app = _select_app(monkeypatch, tmp_path)
    client = TestClient(app)
    assert client.post("/api/models/stt/parakeet-unified-en/select").status_code == 501
