import subprocess
import threading
from typing import Protocol

from server.models import MODELS_DIR


class STTEngine(Protocol):
    def transcribe(self, audio: bytes, language: str | None = None) -> str: ...


def decode_to_pcm(audio: bytes, sample_rate: int = 16000):
    """Decode browser audio (webm/wav/ogg) to mono float32 PCM via ffmpeg."""
    import numpy as np

    proc = subprocess.run(
        ["ffmpeg", "-i", "pipe:0", "-f", "f32le", "-ac", "1",
         "-ar", str(sample_rate), "pipe:1"],
        input=audio, capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "ffmpeg failed to decode audio: "
            + proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1]
        )
    return np.frombuffer(proc.stdout, dtype=np.float32)


class GgufTranscriber:
    """Quantized GGUF ASR models (Handy's catalog) via the transcribe.cpp
    bindings.

    Loads once and stays resident; ggml picks the best available backend
    (CPU/Vulkan), so this runs well without CUDA and uses no VRAM on CPU.
    The session is not thread-safe, hence the lock.
    """

    SAMPLE_RATE = 16000

    def __init__(self, model_id: str, language: str = "en"):
        import transcribe_cpp

        model_dir = MODELS_DIR / "stt" / model_id
        ggufs = sorted(model_dir.glob("*.gguf"))
        if not ggufs:
            raise RuntimeError(f"no .gguf file found in {model_dir}")
        self._model = transcribe_cpp.Model(str(ggufs[0]))
        self._session = self._model.session()
        self._language = language
        self._lock = threading.Lock()

    def transcribe(self, audio: bytes, language: str | None = None) -> str:
        pcm = decode_to_pcm(audio, self.SAMPLE_RATE)
        with self._lock:
            result = self._session.run(pcm, language=language or self._language)
        return (result.text or "").strip()


def make_stt_engine(model_id: str, language: str = "en") -> STTEngine:
    """Build the engine for a registry STT model id."""
    return GgufTranscriber(model_id, language=language)
