import io

import numpy as np
import soundfile as sf

from server.tts import KokoroTTS

import importlib.util

import pytest

# Chatterbox tests build tensors; CI installs no torch (it skips kokoro).
needs_torch = pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="torch not installed")


class FakePipeline:
    def __call__(self, text, voice):
        chunk = np.zeros(2400, dtype=np.float32)  # 0.1 s @ 24 kHz
        yield ("graphemes", "phonemes", chunk)
        yield ("graphemes", "phonemes", chunk)


def test_synthesize_returns_concatenated_wav():
    tts = KokoroTTS.__new__(KokoroTTS)  # skip __init__ (loads real model)
    tts._pipe = FakePipeline()
    tts._voice = "af_heart"

    wav_bytes = tts.synthesize("hello")

    data, samplerate = sf.read(io.BytesIO(wav_bytes))
    assert samplerate == 24000
    assert len(data) == 4800  # two chunks concatenated


class FakeTurbo:
    sr = 24000

    def __init__(self):
        self.calls = []
        self.conds = object()
        self.conditions_used = []

    def generate(self, text, audio_prompt_path=None, **kw):
        import torch
        if audio_prompt_path:
            self.conds = ("clone", audio_prompt_path)
        self.calls.append((text, audio_prompt_path))
        self.conditions_used.append(self.conds)
        self.kwargs = kw
        return torch.zeros(1, 2400)


def _chatterbox(tmp_path, monkeypatch):
    import server.models as models
    from server.tts import ChatterboxTTS
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path.parent)
    tts = ChatterboxTTS.__new__(ChatterboxTTS)
    tts._model = FakeTurbo()
    tts._voice = "default"
    tts._default_conds = tts._model.conds
    tts.model_id = "chatterbox-nano"
    return tts


@needs_torch
def test_chatterbox_synthesize_uses_builtin_voice_by_default(tmp_path, monkeypatch):
    tts = _chatterbox(tmp_path / "tts", monkeypatch)
    data, samplerate = sf.read(io.BytesIO(tts.synthesize("hello")))
    assert samplerate == 24000 and len(data) == 2400
    assert tts._model.calls == [("hello", None)]


@needs_torch
def test_chatterbox_voices_are_reference_clips_plus_default(tmp_path, monkeypatch):
    tmp_path = tmp_path / "tts"
    tts = _chatterbox(tmp_path, monkeypatch)
    assert tts.voices() == ["default"]
    (tmp_path / "voices").mkdir(parents=True)
    (tmp_path / "voices" / "alice.wav").write_bytes(b"RIFF")
    (tmp_path / "voices" / "notes.txt").write_text("ignored")
    assert tts.voices() == ["default", "alice"]
    assert tts.default_voice == "default"
    tts.synthesize("hi", voice="alice")
    assert tts._model.calls[-1] == ("hi", str(tmp_path / "voices" / "alice.wav"))
    assert tts._model.kwargs.get("norm_loudness") is False, "the engine's float64-promoting loudness step is skipped"
    tts.synthesize("hi", voice="nobody")
    assert tts._model.calls[-1] == ("hi", None), "unknown voices fall back to the built-in one"


@needs_torch
def test_chatterbox_restores_builtin_voice_after_clone(tmp_path, monkeypatch):
    tts = _chatterbox(tmp_path / "tts", monkeypatch)
    builtin_conds = tts._model.conds
    clips = tmp_path / "tts" / "voices"
    clips.mkdir(parents=True)
    (clips / "alice.wav").write_bytes(b"RIFF")

    tts.synthesize("first", voice="alice")
    assert tts._model.conditions_used[-1] != builtin_conds
    tts.synthesize("second", voice="default")
    assert tts._model.conditions_used[-1] is builtin_conds


def test_kokoro_exposes_its_curated_voices():
    from server.settings import KOKORO_VOICES
    tts = KokoroTTS.__new__(KokoroTTS)
    tts._voice = "af_heart"
    assert tts.voices() == KOKORO_VOICES
    assert tts.default_voice == "af_heart"


def test_make_tts_engine_routes_by_model_id(monkeypatch):
    import server.tts as mod
    built = []
    monkeypatch.setattr(mod, "KokoroTTS", lambda **kw: built.append(("kokoro", kw)) or "kokoro-engine")
    monkeypatch.setattr(mod.ChatterboxTTS, "__init__", lambda self, model_id, device=None: built.append(("chatterbox", model_id)))
    assert mod.make_tts_engine("kokoro", voice="af_heart", lang_code="a") == "kokoro-engine"
    assert built[0] == ("kokoro", {"voice": "af_heart", "lang_code": "a"})
    assert isinstance(mod.make_tts_engine("chatterbox-nano", voice="x", lang_code="a"), mod.ChatterboxTTS)
    assert built[1] == ("chatterbox", "chatterbox-nano")
    import pytest
    with pytest.raises(ValueError):
        mod.make_tts_engine("nope", voice="x", lang_code="a")


@needs_torch
def test_chatterbox_warms_up_once_at_load(monkeypatch, tmp_path):
    import server.tts as mod
    import server.models as models

    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    fake = FakeTurbo()

    class Loader:
        @staticmethod
        def from_local(ckpt_dir, device, nano=False):
            assert ckpt_dir.endswith("tts/chatterbox-nano") and nano is True
            return fake

    import types, sys
    sys.modules["chatterbox"] = types.ModuleType("chatterbox")
    sys.modules["chatterbox.tts_turbo"] = types.SimpleNamespace(ChatterboxTurboTTS=Loader)
    try:
        tts = mod.ChatterboxTTS("chatterbox-nano", device="cpu")
    finally:
        del sys.modules["chatterbox.tts_turbo"], sys.modules["chatterbox"]
    assert len(fake.calls) == 1, "one warm-up synthesis primes the kernels so the first reply is fast"
    assert fake.calls[0][1] is None
    tts.synthesize("hi")
    assert len(fake.calls) == 2


def test_engines_close_drops_their_models():
    tts = KokoroTTS.__new__(KokoroTTS)
    tts._pipe = FakePipeline()
    tts._voice = "af_heart"
    tts.close()
    assert not hasattr(tts, "_pipe")
    from server.tts import ChatterboxTTS
    cb = ChatterboxTTS.__new__(ChatterboxTTS)
    cb._model = object()
    cb.close()
    assert not hasattr(cb, "_model")
    cb.close()  # idempotent
