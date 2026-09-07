import io
from typing import Protocol

import numpy as np
import soundfile as sf

from server.models import MODELS_DIR, get_model, tts_dir
from server.settings import KOKORO_VOICES

SAMPLE_RATE = 24000


class TTSEngine(Protocol):
    def synthesize(self, text: str, voice: str | None = None) -> bytes: ...
    def voices(self) -> list[str]: ...
    @property
    def default_voice(self) -> str: ...


def _wav_bytes(wav: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, wav, sample_rate, format="WAV")
    return buf.getvalue()


class KokoroTTS:
    def __init__(self, voice: str = "af_heart", lang_code: str = "a"):
        from kokoro import KPipeline  # heavy import; deferred
        from kokoro.model import KModel

        base = MODELS_DIR / "tts"
        config = base / "config.json"
        model = base / "kokoro-v1_0.pth"
        if config.exists() and model.exists():
            self._pipe = KPipeline(lang_code=lang_code, model=KModel(config=str(config), model=str(model)))
            self._voice_paths = {v: str(base / "voices" / f"{v}.pt") for v in KOKORO_VOICES}
        else:
            self._pipe = KPipeline(lang_code=lang_code)
            self._voice_paths = {}
        self._voice = voice

    @property
    def voice(self) -> str:
        return self._voice

    def set_voice(self, voice: str) -> None:
        self._voice = voice

    def voices(self) -> list[str]:
        return list(KOKORO_VOICES)

    @property
    def default_voice(self) -> str:
        return self._voice if self._voice in KOKORO_VOICES else KOKORO_VOICES[0]

    def synthesize(self, text: str, voice: str | None = None) -> bytes:
        name = voice if voice in KOKORO_VOICES else self._voice
        resolved = getattr(self, "_voice_paths", {}).get(name, name)
        chunks = [audio for _, _, audio in self._pipe(text, voice=resolved)]
        if chunks:
            wav = np.concatenate(chunks)
        else:
            wav = np.zeros(1, dtype=np.float32)
        return _wav_bytes(wav, SAMPLE_RATE)


class ChatterboxTTS:
    """Resemble AI Chatterbox Turbo / Nano.

    Loads from the model folder the download manager fills. The repo's built-in
    voice (conds.pt) is used unless a reference clip is chosen: any WAV dropped
    into models/tts/voices/ becomes a voice named after the file. Paralinguistic
    tags such as [laugh] pass straight through in the text.
    """

    VOICES_DIR = MODELS_DIR / "tts" / "voices"

    def __init__(self, model_id: str, device: str | None = None):
        from chatterbox.tts_turbo import ChatterboxTurboTTS  # heavy import; deferred
        import torch

        spec = get_model("tts", model_id)
        if spec is None:
            raise ValueError(f"unknown TTS model: {model_id}")
        device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model_id = model_id
        self._model = ChatterboxTurboTTS.from_local(str(tts_dir(spec)), device, nano=model_id.endswith("nano"))
        self._voices_dir = self.VOICES_DIR
        self._voice = "default"
        # The first generation pays for kernel compilation and lazy loads
        # (over a minute on a cold GPU); take that hit at load time, not on
        # the first spoken reply.
        try:
            self._model.generate("Ready.", audio_prompt_path=None)
        except Exception:  # noqa: BLE001 - warm-up is best effort
            pass

    def voices(self) -> list[str]:
        clips = sorted(p.stem for p in self._voices_dir.glob("*.wav")) if self._voices_dir.exists() else []
        return ["default", *clips]

    @property
    def default_voice(self) -> str:
        return "default"

    def synthesize(self, text: str, voice: str | None = None) -> bytes:
        name = voice or self._voice
        clip = self._voices_dir / f"{name}.wav"
        prompt = str(clip) if name != "default" and clip.exists() else None
        wav = self._model.generate(text, audio_prompt_path=prompt)
        data = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        data = np.asarray(data, dtype=np.float32).reshape(-1)
        if data.size == 0:
            data = np.zeros(1, dtype=np.float32)
        return _wav_bytes(data, int(getattr(self._model, "sr", SAMPLE_RATE)))


def make_tts_engine(model_id: str, *, voice: str, lang_code: str):
    """Build the TTS engine for a registry model id."""
    if model_id == "kokoro":
        return KokoroTTS(voice=voice, lang_code=lang_code)
    if model_id.startswith("chatterbox-"):
        return ChatterboxTTS(model_id)
    raise ValueError(f"unknown TTS model: {model_id}")
