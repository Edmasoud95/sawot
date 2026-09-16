"""Idle release and reload without loading real speech weights."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from server.idle_engine import IdleEngine


class Clock:
    now = 0

    def __call__(self):
        return self.now


class Engine:
    closed = False
    default_voice = "default"

    def close(self):
        self.closed = True

    def voices(self):
        return ["default"]

    def synthesize(self, text, voice=None):
        assert not self.closed
        return text.encode()

    def transcribe(self, data, language=None):
        assert not self.closed
        return data.decode()


def test_unloads_at_ten_minutes_and_reloads_on_next_request():
    clock = Clock()
    initial = Engine()
    engine = IdleEngine(initial, Engine, clock=clock)
    clock.now = 599
    assert not engine.unload_if_idle()
    clock.now = 600
    assert engine.unload_if_idle()
    assert initial.closed
    assert engine.voices() == ["default"]
    assert engine.default_voice == "default"
    assert not engine.loaded  # Settings polling must not reload weights.
    assert engine.synthesize("hello") == b"hello"
    assert engine.loaded
    clock.now = 1199
    assert not engine.unload_if_idle()
    clock.now = 1200
    assert engine.unload_if_idle()
    assert engine.transcribe(b"speech", language="en") == "speech"


def test_running_request_is_protected_and_idle_starts_after_completion():
    clock = Clock()
    entered, finish = Event(), Event()

    class Slow(Engine):
        def synthesize(self, text, voice=None):
            entered.set()
            assert finish.wait(5)
            return super().synthesize(text, voice)

    initial = Slow()
    engine = IdleEngine(initial, Engine, clock=clock)
    with ThreadPoolExecutor() as pool:
        request = pool.submit(engine.synthesize, "hello")
        assert entered.wait(5)
        clock.now = 1000
        try:
            assert not engine.unload_if_idle()
            assert not initial.closed
        finally:
            finish.set()
        assert request.result() == b"hello"
    clock.now = 1599
    assert not engine.unload_if_idle()
    clock.now = 1600
    assert engine.unload_if_idle()


def test_failed_reload_can_be_retried_and_closed_engine_cannot_reload():
    clock = Clock()
    attempts = 0

    def factory():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("load failed")
        return Engine()

    engine = IdleEngine(Engine(), factory, clock=clock)
    clock.now = 600
    engine.unload_if_idle()
    with pytest.raises(RuntimeError, match="load failed"):
        engine.synthesize("hello")
    assert engine.synthesize("hello") == b"hello"
    engine.close()
    with pytest.raises(RuntimeError):
        engine.synthesize("stale request")


def test_cloned_voice_metadata_updates_without_reloading_idle_engine(monkeypatch, tmp_path):
    from server import models
    monkeypatch.setattr(models, "MODELS_DIR", tmp_path)
    clock = Clock()
    engine = IdleEngine(Engine(), Engine, model_id="chatterbox-nano", clock=clock)
    clock.now = 600
    assert engine.unload_if_idle()
    voices = tmp_path / "tts" / "voices"
    voices.mkdir(parents=True)
    clone = voices / "alice.wav"
    clone.write_bytes(b"")
    assert engine.voices() == ["default", "alice"]
    assert not engine.loaded
    clone.unlink()
    assert engine.voices() == ["default"]
    assert not engine.loaded


def test_sidecar_manages_both_engines_and_keeps_selected_models():
    from sidecar.app import create_sidecar_app
    app = create_sidecar_app(Engine(), Engine(), stt_factory=lambda _: Engine(),
                             tts_factory=lambda _: Engine())
    state = app.state.engines
    assert isinstance(state.stt, IdleEngine)
    assert isinstance(state.tts, IdleEngine)
    clock = Clock()
    for engine in (state.stt, state.tts):
        engine._clock = clock
        engine._last_used = 0
    clock.now = 600
    assert state.stt.unload_if_idle()
    assert state.tts.unload_if_idle()
    assert state.stt_model == "whisper-1"
    assert state.tts_model == "kokoro"
    assert state.stt.transcribe(b"hello") == "hello"
    assert state.tts.synthesize("hello") == b"hello"


@pytest.mark.asyncio
async def test_background_timer_unloads_both_and_http_requests_wake_them():
    import asyncio
    import httpx
    from sidecar.app import create_sidecar_app

    app = create_sidecar_app(Engine(), Engine(), stt_factory=lambda _: Engine(),
                             tts_factory=lambda _: Engine())
    state = app.state.engines
    clock = Clock()
    for engine in (state.stt, state.tts):
        engine._clock = clock
        engine._last_used = 0
    clock.now = 600
    async with app.router.lifespan_context(app):
        async def wait_unloaded():
            while state.stt.loaded or state.tts.loaded:
                await asyncio.sleep(0.01)
        await asyncio.wait_for(wait_unloaded(), timeout=5)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/voices")).status_code == 200
            assert not state.tts.loaded
            response = await client.post("/v1/audio/speech", json={"input": "hello", "response_format": "wav"})
            assert response.content == b"hello"
            assert not state.stt.loaded  # Each model wakes independently.
            response = await client.post("/v1/audio/transcriptions", files={"file": ("audio.wav", b"speech")})
            assert response.json()["text"] == "speech"
    assert not state.stt.loaded
    assert not state.tts.loaded
