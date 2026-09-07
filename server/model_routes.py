"""REST endpoints for the model manager (list + download + engine switching)."""

import asyncio
from typing import Callable

from fastapi import HTTPException

from server.models import get_model, is_downloaded, manager


def register_model_routes(
    app,
    state=None,
    *,
    stt_factory: Callable | None = None,
    persist_stt: Callable[[str], None] | None = None,
    tts_factory: Callable | None = None,
    persist_tts: Callable[[str], None] | None = None,
) -> None:
    switch_lock = asyncio.Lock()
    factories = {"stt": (stt_factory, persist_stt), "tts": (tts_factory, persist_tts)}

    @app.get("/api/models")
    async def list_models():
        models = manager.all_status()
        active = {"stt": getattr(state, "stt_model", None), "tts": getattr(state, "tts_model", None)}
        for m in models:
            m["active"] = m["id"] == active.get(m["kind"])
            m["selectable"] = factories.get(m["kind"], (None, None))[0] is not None and m["state"] == "downloaded" and not m["active"]
        return {"models": models}

    @app.get("/api/voices")
    async def list_voices():
        """Voices the active TTS engine can speak with, and its default."""
        engine = getattr(state, "tts", None)
        voices = list(engine.voices()) if engine is not None and hasattr(engine, "voices") else []
        default = getattr(engine, "default_voice", voices[0] if voices else None)
        return {"engine": getattr(state, "tts_model", None), "voices": voices, "default": default}

    @app.post("/api/models/{kind}/{model_id}/download")
    async def start_download(kind: str, model_id: str):
        spec = get_model(kind, model_id)
        if spec is None:
            raise HTTPException(404, f"unknown model: {kind}/{model_id}")
        if is_downloaded(spec):
            return {"ok": True, "state": "downloaded"}
        manager.start(spec)
        return {"ok": True, "state": "downloading"}

    @app.post("/api/models/{kind}/{model_id}/select")
    async def select_model(kind: str, model_id: str):
        spec = get_model(kind, model_id)
        if spec is None:
            raise HTTPException(404, f"unknown model: {kind}/{model_id}")
        factory, persist = factories.get(kind, (None, None))
        if factory is None or state is None:
            raise HTTPException(501, f"{kind} model switching is not enabled")
        if not is_downloaded(spec):
            raise HTTPException(409, "model is not downloaded yet")

        async with switch_lock:
            if getattr(state, f"{kind}_model") != model_id:
                # Loading takes seconds; keep the event loop free. The old
                # engine keeps serving until the new one is ready.
                try:
                    engine = await asyncio.to_thread(factory, model_id)
                except ImportError as e:
                    raise HTTPException(501, f"{model_id} needs an optional package that is not installed: {e}")
                except Exception as e:  # noqa: BLE001 - surfaced to the UI
                    raise HTTPException(500, f"could not load {model_id}: {e}")
                setattr(state, kind, engine)
                setattr(state, f"{kind}_model", model_id)
                if persist:
                    persist(model_id)
        return {"ok": True, "active": getattr(state, f"{kind}_model")}
