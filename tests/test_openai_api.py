from types import SimpleNamespace

from fastapi.testclient import TestClient

from sidecar.app import create_sidecar_app


class FakeSTT:
    def transcribe(self, audio, language=None):
        return "hello world"


class FakeTTS:
    def __init__(self):
        self.synthesized = []

    def synthesize(self, text, voice=None):
        self.synthesized.append((text, voice))
        return b"RIFF-fake-wav"


def make_client(stt=None, tts=None):
    tts = tts or FakeTTS()
    app = create_sidecar_app(stt or FakeSTT(), tts)
    return TestClient(app), tts


def test_speech_wav_native():
    client, tts = make_client()
    resp = client.post("/v1/audio/speech", json={"input": "hello", "response_format": "wav"})
    assert resp.status_code == 200
    assert resp.content == b"RIFF-fake-wav"
    assert resp.headers["content-type"] == "audio/wav"
    assert tts.synthesized == [("hello", None)]


def test_speech_passes_voice():
    client, tts = make_client()
    resp = client.post(
        "/v1/audio/speech",
        json={"input": "hello", "voice": "am_adam", "response_format": "wav"},
    )
    assert resp.status_code == 200
    assert tts.synthesized == [("hello", "am_adam")]


def test_speech_mp3_uses_ffmpeg(monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return SimpleNamespace(returncode=0, stdout=b"MP3DATA", stderr=b"")

    monkeypatch.setattr("server.openai_api.subprocess.run", fake_run)
    client, _ = make_client()
    resp = client.post("/v1/audio/speech", json={"input": "hello"})  # default mp3
    assert resp.status_code == 200
    assert resp.content == b"MP3DATA"
    assert resp.headers["content-type"] == "audio/mpeg"
    assert "pipe:0" in captured["cmd"] and "mp3" in captured["cmd"]


def test_speech_applies_speed_filter(monkeypatch):
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return SimpleNamespace(returncode=0, stdout=b"FAST", stderr=b"")

    monkeypatch.setattr("server.openai_api.subprocess.run", fake_run)
    client, _ = make_client()
    resp = client.post("/v1/audio/speech", json={"input": "x", "speed": 1.5})
    assert resp.status_code == 200
    assert "atempo=1.5" in captured["cmd"]


def test_speech_missing_input_400():
    client, _ = make_client()
    assert client.post("/v1/audio/speech", json={}).status_code == 400


def test_speech_bad_format_400():
    client, _ = make_client()
    resp = client.post("/v1/audio/speech", json={"input": "x", "response_format": "ogg"})
    assert resp.status_code == 400


def test_speech_bad_speed_400():
    client, _ = make_client()
    resp = client.post("/v1/audio/speech", json={"input": "x", "speed": 3.0})
    assert resp.status_code == 400


def test_transcription_json_default():
    client, _ = make_client()
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"audio-bytes", "audio/wav")},
    )
    assert resp.status_code == 200
    assert resp.json() == {"text": "hello world"}


def test_transcription_text_format():
    client, _ = make_client()
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"audio-bytes", "audio/wav")},
        data={"response_format": "text"},
    )
    assert resp.status_code == 200
    assert resp.text == "hello world"


def test_transcription_verbose_json():
    client, _ = make_client()
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"audio-bytes", "audio/wav")},
        data={"response_format": "verbose_json"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["text"] == "hello world"
    assert "segments" in body


def test_transcription_empty_file_400():
    client, _ = make_client()
    resp = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("a.wav", b"", "audio/wav")},
    )
    assert resp.status_code == 400


def test_models_lists_stt_and_tts():
    app = create_sidecar_app(
        FakeSTT(), FakeTTS(), openai_stt_model="whisper-small", tts_model="kokoro"
    )
    resp = TestClient(app).get("/v1/models")
    assert resp.status_code == 200
    ids = [m["id"] for m in resp.json()["data"]]
    assert ids == ["whisper-small", "kokoro"]  # the TTS entry is the model, not a voice


def test_transcription_without_a_model_is_503_with_a_hint():
    from server.stt import MissingSTT

    client, _ = make_client(stt=MissingSTT("cohere-transcribe"))
    resp = client.post("/v1/audio/transcriptions", files={"file": ("a.webm", b"audio", "audio/webm")})
    assert resp.status_code == 503
    assert "not downloaded" in resp.json()["detail"]
