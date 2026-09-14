import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import server.models as models
from server.tts import voices_dir, ChatterboxTTS
from server.voices import prepare_reference, MIN_SECONDS, MAX_SECONDS


def _wav(seconds: float, sr: int = 48000, lead_silence: float = 0.0, tail_silence: float = 0.0) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    data = np.concatenate([np.zeros(int(lead_silence * sr), np.float32), tone, np.zeros(int(tail_silence * sr), np.float32)])
    buf = io.BytesIO()
    sf.write(buf, data, sr, format="WAV")
    return buf.getvalue()


def test_prepare_reference_resamples_to_24k_mono_and_trims_silence():
    pcm, sr = prepare_reference(_wav(8.0, lead_silence=1.5, tail_silence=2.0))
    assert sr == 24000
    assert 7.8 <= len(pcm) / sr <= 8.3, "leading and trailing silence are cut, the speech is kept"
    assert pcm.dtype == np.float32 and pcm.ndim == 1


def test_prepare_reference_normalises_loudness_in_float32():
    pyloudnorm = pytest.importorskip("pyloudnorm")
    quiet = _wav(8.0)
    data, sr = sf.read(io.BytesIO(quiet)); quiet_buf = io.BytesIO(); sf.write(quiet_buf, data * 0.05, sr, format="WAV")
    pcm, sr = prepare_reference(quiet_buf.getvalue())
    assert pcm.dtype == np.float32, "Chatterbox rejects float64 clips"
    assert abs(pyloudnorm.Meter(sr).integrated_loudness(pcm) - (-27.0)) < 1.0
    assert float(np.abs(pcm).max()) <= 0.99


def test_prepare_reference_caps_long_clips_and_rejects_short_ones():
    pcm, sr = prepare_reference(_wav(MAX_SECONDS + 10))
    assert len(pcm) / sr == pytest.approx(MAX_SECONDS, abs=0.05)
    with pytest.raises(ValueError, match="at least"):
        prepare_reference(_wav(MIN_SECONDS / 2))
    with pytest.raises(ValueError, match="at least"):
        prepare_reference(_wav(0.5, lead_silence=5.0), )  # mostly silence


def _app(monkeypatch, tmp_path):
    from sidecar.app import create_sidecar_app

    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)

    class Engine:
        def voices(self):
            return ["default", *sorted(p.stem for p in voices_dir().glob("*.wav"))]
        default_voice = "default"

    return TestClient(create_sidecar_app(None, Engine(), tts_model="chatterbox-turbo"))


def test_clone_route_saves_a_named_voice_and_lists_it(monkeypatch, tmp_path):
    client = _app(monkeypatch, tmp_path)
    resp = client.post("/api/voices", data={"name": "Ed's voice"}, files={"file": ("clip.wav", _wav(8.0), "audio/wav")})
    assert resp.status_code == 200, resp.text
    assert resp.json()["voice"] == "Ed's voice"
    assert resp.json()["voices"] == ["default", "Ed's voice"]
    saved = tmp_path / "tts" / "voices" / "Ed's voice.wav"
    assert saved.exists()
    data, sr = sf.read(saved)
    assert sr == 24000 and data.ndim == 1
    assert client.get("/api/voices").json()["voices"] == ["default", "Ed's voice"]
    assert client.get("/api/voices").json()["clones"] == ["Ed's voice"]


def test_clones_are_listed_even_when_kokoro_is_active(monkeypatch, tmp_path):
    from sidecar.app import create_sidecar_app

    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    (tmp_path / "tts" / "voices").mkdir(parents=True)
    (tmp_path / "tts" / "voices" / "Ed.wav").write_bytes(b"RIFF")

    class Kokoro:
        default_voice = "af_heart"
        def voices(self):
            return ["af_heart"]

    client = TestClient(create_sidecar_app(None, Kokoro(), tts_model="kokoro"))
    body = client.get("/api/voices").json()
    assert body["voices"] == ["af_heart"] and body["clones"] == ["Ed"], "clones can be managed before switching engines"
    assert client.delete("/api/voices/Ed").json()["clones"] == []


def test_clone_route_validates_name_and_audio(monkeypatch, tmp_path):
    client = _app(monkeypatch, tmp_path)
    good = lambda: {"file": ("clip.wav", _wav(8.0), "audio/wav")}  # noqa: E731
    assert client.post("/api/voices", data={"name": "default"}, files=good()).status_code == 400
    assert client.post("/api/voices", data={"name": "../../etc"}, files=good()).status_code == 400
    assert client.post("/api/voices", data={"name": ""}, files=good()).status_code == 400
    assert client.post("/api/voices", data={"name": "x" * 41}, files=good()).status_code == 400
    short = client.post("/api/voices", data={"name": "Short"}, files={"file": ("c.wav", _wav(1.0), "audio/wav")})
    assert short.status_code == 400 and "at least" in short.json()["detail"]
    garbage = client.post("/api/voices", data={"name": "Bad"}, files={"file": ("c.webm", b"not audio", "audio/webm")})
    assert garbage.status_code == 400
    assert not (tmp_path / "tts" / "voices").exists() or not list((tmp_path / "tts" / "voices").glob("*.wav"))


def test_delete_route_removes_only_cloned_voices(monkeypatch, tmp_path):
    client = _app(monkeypatch, tmp_path)
    client.post("/api/voices", data={"name": "Gone"}, files={"file": ("clip.wav", _wav(8.0), "audio/wav")})
    assert client.delete("/api/voices/default").status_code == 400
    assert client.delete("/api/voices/nobody").status_code == 404
    resp = client.delete("/api/voices/Gone")
    assert resp.status_code == 200 and resp.json()["voices"] == ["default"]
    assert not (tmp_path / "tts" / "voices" / "Gone.wav").exists()


def test_chatterbox_reads_the_voices_dir_at_call_time(monkeypatch, tmp_path):
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    assert voices_dir() == tmp_path / "tts" / "voices"
    tts = ChatterboxTTS.__new__(ChatterboxTTS)
    tts._voice = "default"
    tts._model = None
    (tmp_path / "tts" / "voices").mkdir(parents=True)
    (tmp_path / "tts" / "voices" / "new.wav").write_bytes(b"RIFF")
    assert tts.voices() == ["default", "new"], "a clone saved after the engine loaded is visible at once"
