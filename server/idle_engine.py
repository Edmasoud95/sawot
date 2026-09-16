"""Release speech weights after ten idle minutes; reload on actual inference."""
import logging
import threading
import time

from server.model_routes import _free_accelerator_memory
from server.stt import ModelNotDownloaded

logger = logging.getLogger("voice.models")
IDLE_SECONDS = 600


class IdleEngine:
    def __init__(self, engine, factory, *, model_id="", clock=time.monotonic):
        self._engine = engine
        self._model_id = model_id
        self._factory = factory
        self._clock = clock
        self._last_used = clock()
        self._lock = threading.Lock()
        self._closed = False
        # Metadata queries must not keep weights alive or trigger a reload.
        self._voices = list(engine.voices()) if hasattr(engine, "voices") else []
        self._default_voice = getattr(engine, "default_voice", None)

    @property
    def loaded(self):
        return self._engine is not None

    def voices(self):
        # Chatterbox voice clones can change even while weights are asleep.
        if self._model_id.startswith("chatterbox-"):
            from server.voices import cloned_voices
            return ["default", *cloned_voices()]
        return list(self._voices)

    @property
    def default_voice(self):
        return self._default_voice

    def _call(self, method, *args, **kwargs):
        # The lock lives in the worker thread, so cancellation of an HTTP
        # request cannot release weights while native inference is still running.
        with self._lock:
            if self._closed:
                raise ModelNotDownloaded("model was replaced; retry the request")
            try:
                if self._engine is None:
                    self._engine = self._factory()
                    logger.info("reloaded idle speech model")
                return getattr(self._engine, method)(*args, **kwargs)
            finally:
                self._last_used = self._clock()

    def transcribe(self, audio, language=None):
        return self._call("transcribe", audio, language=language)

    def synthesize(self, text, voice=None):
        if voice is None:
            return self._call("synthesize", text)
        return self._call("synthesize", text, voice)

    def _release(self):
        old, self._engine = self._engine, None
        try:
            if old is not None and hasattr(old, "close"):
                old.close()
        finally:
            del old
            _free_accelerator_memory()

    def unload_if_idle(self):
        if not self._lock.acquire(blocking=False):
            return False
        try:
            if self._engine is None or self._clock() - self._last_used < IDLE_SECONDS:
                return False
            self._release()
            logger.info("unloaded speech model after ten idle minutes")
            return True
        finally:
            self._lock.release()

    def close(self):
        with self._lock:
            self._closed = True
            self._release()
