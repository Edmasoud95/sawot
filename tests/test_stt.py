import server.stt as stt_mod


class FakeEngine:
    def __init__(self, model_id, language="en"):
        self.args = (model_id, language)


def test_make_stt_engine_builds_gguf_engine(monkeypatch):
    monkeypatch.setattr(stt_mod, "GgufTranscriber", FakeEngine)

    engine = stt_mod.make_stt_engine("cohere-transcribe", language="de")
    assert engine.args == ("cohere-transcribe", "de")

    engine = stt_mod.make_stt_engine("parakeet-unified-en")
    assert engine.args == ("parakeet-unified-en", "en")


def test_gguf_transcriber_requires_downloaded_file(monkeypatch, tmp_path):
    import pytest

    monkeypatch.setattr(stt_mod, "MODELS_DIR", tmp_path)
    with pytest.raises(RuntimeError, match="no .gguf file"):
        stt_mod.GgufTranscriber("cohere-transcribe")


def test_decode_to_pcm_roundtrips_wav():
    import io

    import numpy as np
    import soundfile as sf

    tone = np.sin(np.linspace(0, 2 * np.pi * 440, 16000)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, tone, 16000, format="WAV")

    pcm = stt_mod.decode_to_pcm(buf.getvalue())
    assert pcm.dtype == np.float32
    assert abs(len(pcm) - 16000) < 100  # ~1 s at 16 kHz


def test_decode_to_pcm_rejects_garbage():
    import pytest

    with pytest.raises(RuntimeError, match="ffmpeg"):
        stt_mod.decode_to_pcm(b"not audio at all")


def test_missing_stt_reports_which_model_to_download():
    import pytest

    engine = stt_mod.MissingSTT("cohere-transcribe")
    with pytest.raises(stt_mod.ModelNotDownloaded, match="cohere-transcribe.*Settings"):
        engine.transcribe(b"audio")
