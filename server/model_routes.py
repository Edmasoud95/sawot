"""REST endpoints for the model manager (list + download + engine switching)."""

import asyncio
import gc
import logging
from typing import Callable

from fastapi import HTTPException

from server.models import get_model, is_downloaded, manager
from server.stt import UnavailableEngine

logger = logging.getLogger("voice.models")

KIND_LABEL = {"stt": "speech-to-text", "tts": "text-to-speech"}


def _free_accelerator_memory() -> None:
    """Return freed memory to the OS and GPU driver, not just to the
    allocators' caches: glibc keeps released heap mapped (the sidecar sat on
    3.5 GB of dead weights after unloading Chatterbox) and torch keeps VRAM
    reserved unless told otherwise."""
    gc.collect()
    try:
        import torch
    except ImportError:
        torch = None
    if torch is not None and torch.cuda.is_available():
        torch.cuda.synchronize()
        torch.cuda.empty_cache()
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except (OSError, AttributeError):
        pass  # not glibc (macOS, musl); nothing to trim


def unload_engine(state, kind: str, message: str) -> None:
    """Unload the live engine of one kind, first, so that at no point do two
    models share the machine's memory. Requests that arrive before the next
    engine is ready get ``message`` as a 503."""
    old = getattr(state, kind, None)
    setattr(state, kind, UnavailableEngine(message))
    if old is not None and hasattr(old, "close"):
        try:
            old.close()
        except Exception:  # noqa: BLE001 - the reference is dropped regardless
            logger.exception("closing the old %s engine failed", kind)
    del old
    _free_accelerator_memory()


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
            previous = getattr(state, f"{kind}_model")
            if previous != model_id:
                label = KIND_LABEL.get(kind, kind)
                # Unload first: holding two models at once has taken the whole
                # machine down, so the old one is freed before the new one is
                # even started. Loading takes seconds; keep the event loop free.
                await asyncio.to_thread(unload_engine, state, kind, f"{label} model {model_id} is loading")
                setattr(state, f"{kind}_model", None)
                try:
                    engine = await asyncio.to_thread(factory, model_id)
                except Exception as e:  # noqa: BLE001 - surfaced to the UI
                    await _restore(state, kind, previous, factory)
                    if isinstance(e, ImportError):
                        raise HTTPException(501, f"{model_id} needs an optional package that is not installed: {e}")
                    raise HTTPException(500, f"could not load {model_id}: {e}")
                setattr(state, kind, engine)
                setattr(state, f"{kind}_model", model_id)
                if persist:
                    persist(model_id)
        return {"ok": True, "active": getattr(state, f"{kind}_model")}

    async def _restore(state, kind: str, previous: str | None, factory: Callable) -> None:
        """A switch failed after the old model was unloaded: bring it back,
        or leave a placeholder that says why nothing is loaded."""
        label = KIND_LABEL.get(kind, kind)
        if previous:
            try:
                setattr(state, kind, await asyncio.to_thread(factory, previous))
                setattr(state, f"{kind}_model", previous)
                return
            except Exception:  # noqa: BLE001 - reported below
                logger.exception("reloading the previous %s model %s failed", kind, previous)
        setattr(state, kind, UnavailableEngine(f"no {label} model is loaded — pick one in Settings"))
        setattr(state, f"{kind}_model", None)
