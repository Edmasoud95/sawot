"""Python inference sidecar: STT + TTS + model manager over HTTP.

The TypeScript backend calls this small service for speech-to-text and
text-to-speech. It isolates the only Python-native dependencies
(transcribe.cpp, Kokoro) behind a tiny HTTP API on localhost.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Callable

from server.idle_engine import IdleEngine

from fastapi import FastAPI

from server.model_routes import register_model_routes
from server.openai_api import register_openai_api
from server.voices import register_voice_routes


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
    def managed_factory(factory):
        if factory is None:
            return None

        def load(model_id):
            return IdleEngine(factory(model_id), lambda: factory(model_id), model_id=model_id)
        return load

    if stt is not None and stt_factory is not None and openai_stt_model:
        factory = stt_factory
        stt = IdleEngine(stt, lambda: factory(openai_stt_model), model_id=openai_stt_model)
    if tts is not None and tts_factory is not None and tts_model:
        tts_loader = tts_factory
        tts = IdleEngine(tts, lambda: tts_loader(tts_model), model_id=tts_model)
    state = EngineState(stt, tts, openai_stt_model, tts_model)

    @asynccontextmanager
    async def lifespan(app):
        stop = asyncio.Event()

        async def release_idle():
            while not stop.is_set():
                for kind in ("stt", "tts"):
                    engine = getattr(state, kind)
                    if isinstance(engine, IdleEngine):
                        try:
                            await asyncio.to_thread(engine.unload_if_idle)
                        except Exception:
                            logging.getLogger("voice.models").exception("idle %s release failed", kind)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=1)
                except asyncio.TimeoutError:
                    pass

        task = asyncio.create_task(release_idle())
        try:
            yield
        finally:
            stop.set()
            await task
            for kind in ("stt", "tts"):
                engine = getattr(state, kind)
                if isinstance(engine, IdleEngine):
                    await asyncio.to_thread(engine.close)

    app = FastAPI(title="SAWOT inference sidecar", lifespan=lifespan)
    app.state.engines = state

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "sawot-inference"}

    # OpenAI-compatible audio endpoints: POST /v1/audio/speech + /v1/audio/transcriptions
    register_openai_api(app, state)
    # Model registry + download manager + STT switching:
    # GET /api/models, POST /api/models/{kind}/{id}/download, POST .../select
    register_model_routes(app, state, stt_factory=managed_factory(stt_factory), persist_stt=persist_stt,
                          tts_factory=managed_factory(tts_factory), persist_tts=persist_tts)
    # Voice cloning: POST /api/voices (name + recording), DELETE /api/voices/{name}
    register_voice_routes(app, state)
    return app
