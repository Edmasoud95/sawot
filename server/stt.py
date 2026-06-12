import io

from faster_whisper import WhisperModel


class Transcriber:
    """faster-whisper wrapper. Accepts encoded audio bytes (webm/wav/ogg);
    decoding is handled by PyAV inside faster-whisper."""

    def __init__(self, model_size: str, device: str = "cuda"):
        compute_type = "float16" if device == "cuda" else "int8"
        self._model = WhisperModel(model_size, device=device, compute_type=compute_type)

    def transcribe(self, audio: bytes) -> str:
        segments, _info = self._model.transcribe(
            io.BytesIO(audio), language="en", vad_filter=True
        )
        return " ".join(s.text.strip() for s in segments).strip()
