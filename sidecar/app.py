"""Python inference sidecar: STT + TTS + model manager over HTTP.

The TypeScript backend calls this small service for speech-to-text and
text-to-speech. It isolates the only Python-native dependencies
(transcribe.cpp, Kokoro) behind a tiny HTTP API on localhost.
"""

from typing import Callable

from fastapi import FastAPI

from server.model_routes import register_model_routes
from server.openai_api import register_openai_api


class EngineState:
    """Mutable holder for the live engines, so STT and TTS models can be
    swapped at runtime without rebuilding the app."""

    def __init__(self, stt, tts, stt_model: str, tts_model: str):
        self.stt = stt
        self.tts = tts
        self.stt_model = stt_model
        self.tts_model = tts_model


def create_sidecar_app(
    stt,
    tts,
    openai_stt_model: str = "whisper-1",
    tts_model: str = "kokoro",
    stt_factory: Callable | None = None,
    persist_stt: Callable[[str], None] | None = None,
    tts_factory: Callable | None = None,
    persist_tts: Callable[[str], None] | None = None,
) -> FastAPI:
    app = FastAPI(title="SAWOT inference sidecar")
    state = EngineState(stt, tts, openai_stt_model, tts_model)

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "sawot-inference"}

    # OpenAI-compatible audio endpoints: POST /v1/audio/speech + /v1/audio/transcriptions
    register_openai_api(app, state)
    # Model registry + download manager + STT switching:
    # GET /api/models, POST /api/models/{kind}/{id}/download, POST .../select
    register_model_routes(app, state, stt_factory=stt_factory, persist_stt=persist_stt,
                          tts_factory=tts_factory, persist_tts=persist_tts)
    return app
