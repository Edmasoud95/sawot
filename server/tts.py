import io
from typing import Protocol

import numpy as np
import soundfile as sf

from server.models import MODELS_DIR
from server.settings import KOKORO_VOICES

SAMPLE_RATE = 24000


class TTSEngine(Protocol):
    def synthesize(self, text: str, voice: str | None = None) -> bytes: ...


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

    def synthesize(self, text: str, voice: str | None = None) -> bytes:
        name = voice or self._voice
        resolved = getattr(self, "_voice_paths", {}).get(name, name)
        chunks = [audio for _, _, audio in self._pipe(text, voice=resolved)]
        if chunks:
            wav = np.concatenate(chunks)
        else:
            wav = np.zeros(1, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, wav, SAMPLE_RATE, format="WAV")
        return buf.getvalue()
