import io

import numpy as np
import soundfile as sf

from server.tts import KokoroTTS


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
