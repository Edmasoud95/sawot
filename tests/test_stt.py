from types import SimpleNamespace

import server.stt as stt_mod
from server.stt import Transcriber


class FakeWhisperModel:
    def __init__(self, model_size, device, compute_type):
        self.args = (model_size, device, compute_type)

    def transcribe(self, audio, language, vad_filter):
        segments = [SimpleNamespace(text=" Hello "), SimpleNamespace(text=" world. ")]
        return iter(segments), SimpleNamespace()


def test_transcribe_joins_segments(monkeypatch):
    monkeypatch.setattr(stt_mod, "WhisperModel", FakeWhisperModel)
    t = Transcriber("distil-small.en", device="cpu")
    assert t._model.args == ("distil-small.en", "cpu", "int8")
    assert t.transcribe(b"fake-audio-bytes") == "Hello world."


def test_cuda_uses_float16(monkeypatch):
    monkeypatch.setattr(stt_mod, "WhisperModel", FakeWhisperModel)
    t = Transcriber("distil-small.en", device="cuda")
    assert t._model.args == ("distil-small.en", "cuda", "float16")
