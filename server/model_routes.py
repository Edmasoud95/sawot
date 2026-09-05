"""REST endpoints for the model manager (list + download + STT switching)."""

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
) -> None:
    switch_lock = asyncio.Lock()

    @app.get("/api/models")
    async def list_models():
        models = manager.all_status()
        active_stt = getattr(state, "stt_model", None)
        for m in models:
            # The TTS engine is always Kokoro; STT follows the selected model.
            m["active"] = m["id"] == active_stt if m["kind"] == "stt" else True
            m["selectable"] = m["kind"] == "stt" and stt_factory is not None
        return {"models": models}

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
        if kind != "stt":
            raise HTTPException(400, "only speech-to-text models can be switched")
        if stt_factory is None or state is None:
            raise HTTPException(501, "model switching is not enabled")
        if not is_downloaded(spec):
            raise HTTPException(409, "model is not downloaded yet")

        async with switch_lock:
            if state.stt_model != model_id:
                # Loading takes seconds; keep the event loop free. The old
                # engine keeps serving until the new one is ready.
                state.stt = await asyncio.to_thread(stt_factory, model_id)
                state.stt_model = model_id
                if persist_stt:
                    persist_stt(model_id)
        return {"ok": True, "active": state.stt_model}
