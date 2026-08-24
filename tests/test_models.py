import server.models as models
from server.models import all_models, download, get_model, is_downloaded


def test_registry_has_recommended_stt_and_tts():
    specs = all_models()
    assert {s.kind for s in specs} == {"stt", "tts"}
    assert any(s.recommended for s in specs if s.kind == "stt")
    assert any(s.recommended for s in specs if s.kind == "tts")


def test_get_model_lookup():
    assert get_model("stt", "distil-small.en").recommended is True
    assert get_model("tts", "kokoro").kind == "tts"
    assert get_model("stt", "does-not-exist") is None


def test_is_downloaded_checks_local_files(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    (tmp_path / "stt" / "tiny.en").mkdir(parents=True)
    (tmp_path / "stt" / "tiny.en" / "model.bin").write_bytes(b"x")
    assert is_downloaded(get_model("stt", "tiny.en")) is True
    assert is_downloaded(get_model("stt", "base.en")) is False

    (tmp_path / "tts").mkdir()
    assert is_downloaded(get_model("tts", "kokoro")) is False
    (tmp_path / "tts" / "kokoro-v1_0.pth").write_bytes(b"x")
    assert is_downloaded(get_model("tts", "kokoro")) is True


def test_download_stt_calls_snapshot(monkeypatch):
    calls = {}

    def fake_snapshot(repo_id, local_dir, tqdm_class=None):
        calls["repo"] = repo_id
        calls["local_dir"] = local_dir

    monkeypatch.setattr(models, "snapshot_download", fake_snapshot)
    download(get_model("stt", "tiny.en"))
    assert calls["repo"] == "Systran/faster-whisper-tiny.en"
    assert calls["local_dir"].endswith("models/stt/tiny.en")


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


def test_download_passes_none_tqdm_without_callback(monkeypatch):
    seen = {}

    def fake_snapshot(repo_id, local_dir, tqdm_class=None):
        seen["tqdm_class"] = tqdm_class

    monkeypatch.setattr(models, "snapshot_download", fake_snapshot)
    download(get_model("stt", "tiny.en"))
    assert seen["tqdm_class"] is None


async def test_manager_status_and_run(monkeypatch, tmp_path):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    manager = models.ModelManager()
    spec = get_model("stt", "tiny.en")
    assert manager.status(spec)["state"] == "not_downloaded"

    def fake_download(spec, on_update=None):
        (tmp_path / "stt" / "tiny.en").mkdir(parents=True, exist_ok=True)
        (tmp_path / "stt" / "tiny.en" / "model.bin").write_bytes(b"x")
        if on_update:
            on_update(100, 100)

    monkeypatch.setattr(models, "download", fake_download)
    await manager._run(spec)
    assert manager.status(spec)["state"] == "downloaded"


def test_models_route_marks_configured_stt_active():
    from fastapi.testclient import TestClient

    from sidecar.app import create_sidecar_app

    app = create_sidecar_app(None, None, openai_stt_model="distil-small.en")
    client = TestClient(app)
    by_id = {
        (m["kind"], m["id"]): m
        for m in client.get("/api/models").json()["models"]
    }
    assert by_id[("stt", "distil-small.en")]["active"] is True
    assert by_id[("stt", "tiny.en")]["active"] is False
    assert by_id[("tts", "kokoro")]["active"] is True
