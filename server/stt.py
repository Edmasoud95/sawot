import io
from typing import Protocol

from faster_whisper import WhisperModel

from server.models import MODELS_DIR


class STTEngine(Protocol):
    def transcribe(self, audio: bytes, language: str | None = None) -> str: ...


class Transcriber:
    """faster-whisper wrapper. Accepts encoded audio bytes (webm/wav/ogg);
    decoding is handled by PyAV inside faster-whisper."""

    def __init__(
        self,
        model_size: str,
        device: str = "cuda",
        language: str = "en",
        vad_filter: bool = True,
    ):
        compute_type = "float16" if device == "cuda" else "int8"
        local = MODELS_DIR / "stt" / model_size / "model.bin"
        model_path = str(MODELS_DIR / "stt" / model_size) if local.exists() else model_size
        self._model = WhisperModel(model_path, device=device, compute_type=compute_type)
        self._language = language
        self._vad_filter = vad_filter

    def transcribe(self, audio: bytes, language: str | None = None) -> str:
        segments, _info = self._model.transcribe(
            io.BytesIO(audio),
            language=language or self._language,
            vad_filter=self._vad_filter,
        )
        return " ".join(s.text.strip() for s in segments).strip()
