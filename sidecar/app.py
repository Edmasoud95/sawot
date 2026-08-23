"""Python inference sidecar: STT + TTS + model manager over HTTP.

The TypeScript backend calls this small service for speech-to-text and
text-to-speech. It isolates the only Python-native dependencies
(faster-whisper, Kokoro) behind a tiny HTTP API on localhost.
"""

from fastapi import FastAPI

from server.model_routes import register_model_routes
from server.openai_api import register_openai_api


def create_sidecar_app(
    stt,
    tts,
    openai_stt_model: str = "whisper-1",
    openai_tts_model: str = "tts-1",
) -> FastAPI:
    app = FastAPI(title="SAWOT inference sidecar")

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "sawot-inference"}

    # OpenAI-compatible audio endpoints: POST /v1/audio/speech + /v1/audio/transcriptions
    register_openai_api(app, stt, tts, stt_model=openai_stt_model, tts_model=openai_tts_model)
    # Model registry + download manager: GET /api/models, POST /api/models/{kind}/{id}/download
    register_model_routes(app)
    return app
