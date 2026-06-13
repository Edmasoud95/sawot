import logging
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("voice")

WEB_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"


def create_app(stt, agent, tts, settings_ctx=None) -> FastAPI:
    app = FastAPI()

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        history: list[dict] = []

        async def debug(event: str, data: dict) -> None:
            await websocket.send_json({"type": "debug", "event": event, "data": data})

        try:
            while True:
                audio = await websocket.receive_bytes()
                t0 = time.perf_counter()
                text = await run_in_threadpool(stt.transcribe, audio)
                await debug(
                    "stt",
                    {"text": text, "latency_ms": round((time.perf_counter() - t0) * 1000)},
                )
                if not text:
                    await websocket.send_json(
                        {"type": "error", "message": "I didn't catch that"}
                    )
                    continue
                await websocket.send_json({"type": "transcript", "text": text})
                checkpoint = len(history)
                try:
                    reply = await agent.run(history, text, on_event=debug)
                except Exception:
                    logger.exception("agent failure")
                    del history[checkpoint:]
                    await websocket.send_json(
                        {"type": "error", "message": "LLM backend offline"}
                    )
                    continue
                await websocket.send_json({"type": "assistant_text", "text": reply})
                t1 = time.perf_counter()
                wav = await run_in_threadpool(tts.synthesize, reply)
                await debug(
                    "tts",
                    {
                        "latency_ms": round((time.perf_counter() - t1) * 1000),
                        "bytes": len(wav),
                    },
                )
                await websocket.send_bytes(wav)
        except WebSocketDisconnect:
            pass

    if settings_ctx is not None:
        _register_settings_routes(app, settings_ctx)

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

    return app


async def _fetch_models(ctx) -> list[str]:
    resp = await ctx.http.get(f"{ctx.lmstudio_url}/models")
    resp.raise_for_status()
    return [m["id"] for m in resp.json().get("data", [])]


def _register_settings_routes(app, ctx) -> None:
    from fastapi import HTTPException

    from server.settings import KOKORO_VOICES

    def payload(models: list[str], error: str | None = None) -> dict:
        data = {
            "model": ctx.agent.model,
            "voice": ctx.tts.voice,
            "models": models,
            "voices": KOKORO_VOICES,
        }
        if error:
            data["models_error"] = error
        return data

    @app.get("/api/settings")
    async def get_settings():
        try:
            return payload(await _fetch_models(ctx))
        except Exception as exc:
            return payload([], error=str(exc))

    @app.post("/api/settings")
    async def post_settings(body: dict):
        model = body.get("model")
        voice = body.get("voice")
        if voice is not None and voice not in KOKORO_VOICES:
            raise HTTPException(400, f"unknown voice: {voice}")
        models: list[str] = []
        if model is not None:
            try:
                models = await _fetch_models(ctx)
            except Exception as exc:
                raise HTTPException(502, f"LM Studio unreachable: {exc}")
            if model not in models:
                raise HTTPException(400, f"unknown model: {model}")
            ctx.agent.set_model(model)
        if voice is not None:
            ctx.tts.set_voice(voice)
        ctx.store.save({"model": ctx.agent.model, "voice": ctx.tts.voice})
        if not models:
            try:
                models = await _fetch_models(ctx)
            except Exception as exc:
                return payload([], error=str(exc))
        return payload(models)


def main() -> None:
    import asyncio

    asyncio.run(_main())


async def _main() -> None:
    import uvicorn
    from openai import AsyncOpenAI

    from server.config import load_config
    from server.ha import HomeAssistant
    from server.llm import Agent, build_system_prompt
    from server.stt import Transcriber
    from server.tts import KokoroTTS

    logging.basicConfig(level=logging.INFO)
    config = load_config()

    import httpx

    from server.settings import SettingsContext, SettingsStore

    ha = HomeAssistant(config.ha_url, config.ha_token)
    summary = await _startup_summary(ha)

    store = SettingsStore()
    overrides = store.load()
    model = overrides.get("model", config.lmstudio_model)
    voice = overrides.get("voice", config.tts_voice)

    llm_client = AsyncOpenAI(base_url=config.lmstudio_url, api_key="lm-studio")
    agent = Agent(llm_client, model, ha, build_system_prompt(summary))

    logger.info("loading STT model %s on %s", config.stt_model, config.stt_device)
    stt = Transcriber(config.stt_model, device=config.stt_device)
    logger.info("loading Kokoro TTS (voice=%s)", voice)
    tts = KokoroTTS(voice=voice)

    settings_ctx = SettingsContext(
        store=store,
        agent=agent,
        tts=tts,
        lmstudio_url=config.lmstudio_url,
        http=httpx.AsyncClient(timeout=10.0),
    )
    app = create_app(stt, agent, tts, settings_ctx=settings_ctx)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=config.host,
            port=config.port,
            ssl_certfile=config.ssl_certfile,
            ssl_keyfile=config.ssl_keyfile,
        )
    )
    try:
        await server.serve()
    finally:
        await settings_ctx.http.aclose()
        await ha.aclose()


async def _startup_summary(ha) -> str:
    try:
        await ha.load_areas()
        return await ha.entity_summary()
    except Exception:
        logger.exception("could not fetch entities from Home Assistant")
        return "(device list unavailable — use get_entities tool)"


if __name__ == "__main__":
    main()
