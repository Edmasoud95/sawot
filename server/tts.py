import io
from typing import Protocol

import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000


class TTSEngine(Protocol):
    def synthesize(self, text: str) -> bytes: ...


class KokoroTTS:
    def __init__(self, voice: str = "af_heart"):
        from kokoro import KPipeline  # heavy import; deferred

        self._pipe = KPipeline(lang_code="a")  # 'a' = American English
        self._voice = voice

    def synthesize(self, text: str) -> bytes:
        chunks = [audio for _, _, audio in self._pipe(text, voice=self._voice)]
        if chunks:
            wav = np.concatenate(chunks)
        else:
            wav = np.zeros(1, dtype=np.float32)
        buf = io.BytesIO()
        sf.write(buf, wav, SAMPLE_RATE, format="WAV")
        return buf.getvalue()
