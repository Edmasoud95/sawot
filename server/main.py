import json
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from server.openai_api import register_openai_api
from server.pipeline import run_voice_turn

ALLOWED_CONTROLS = {
    "light": {"turn_on", "turn_off"},
    "switch": {"turn_on", "turn_off"},
    "media_player": {"turn_on", "turn_off"},
    "climate": {"set_temperature"},
}

logger = logging.getLogger("voice")

WEB_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"


async def _handle_control(websocket, ha, raw: str, allowed_controls: dict) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await websocket.send_json({"type": "error", "message": "malformed message"})
        return
    if msg.get("type") != "control":
        await websocket.send_json({"type": "error", "message": "unknown message type"})
        return
    domain = msg.get("domain")
    service = msg.get("service")
    entity_id = msg.get("entity_id")
    if (
        ha is None
        or not entity_id
        or service not in allowed_controls.get(domain, set())
    ):
        await websocket.send_json({"type": "error", "message": "control not allowed"})
        return
    logger.info("control: %s.%s on %s data=%s", domain, service, entity_id, msg.get("data"))
    try:
        await ha.call_service(domain, service, entity_id, msg.get("data"))
        cards = await ha.get_cards([entity_id])
        await websocket.send_json({"type": "entities", "entities": cards})
    except Exception:
        logger.exception("control failed")
        await websocket.send_json({"type": "error", "message": "control failed"})


def create_app(
    stt,
    agent,
    tts,
    settings_ctx=None,
    ha=None,
    chat_ctx=None,
    allowed_controls=None,
    openai_stt_model: str = "whisper-1",
    openai_tts_model: str = "tts-1",
) -> FastAPI:
    app = FastAPI()
    controls = allowed_controls or ALLOWED_CONTROLS

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        history: list[dict] = []

        async def send(kind: str, payload) -> None:
            if kind == "wav":
                await websocket.send_bytes(payload)
            else:
                await websocket.send_json({"type": kind, **payload})

        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("text") is not None:
                    await _handle_control(websocket, ha, message["text"], controls)
                    continue
                audio = message.get("bytes")
                if audio is None:
                    continue
                await run_voice_turn(
                    stt,
                    agent,
                    tts,
                    audio,
                    history,
                    send=send,
                    get_cards=(ha.get_cards if ha is not None else None),
                )
        except WebSocketDisconnect:
            pass

    if settings_ctx is not None:
        _register_settings_routes(app, settings_ctx)

    if chat_ctx is not None:
        from server.chat_routes import register_chat_routes

        register_chat_routes(app, chat_ctx)

    register_openai_api(
        app, stt, tts, stt_model=openai_stt_model, tts_model=openai_tts_model
    )

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
            "sassy": ctx.sassy,
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
        from server.llm import build_system_prompt

        model = body.get("model")
        voice = body.get("voice")
        sassy = body.get("sassy")
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
        if sassy is not None:
            ctx.sassy = bool(sassy)
            prompt = build_system_prompt(ctx.summary, sassy=ctx.sassy, name=ctx.name)
            ctx.agent.set_system_prompt(prompt)
            if ctx.chat_ctx is not None:
                ctx.chat_ctx.system_prompt = prompt
        ctx.store.save(
            {"model": ctx.agent.model, "voice": ctx.tts.voice, "sassy": ctx.sassy}
        )
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
    from server.ha_tools import build_ha_tools
    from server.llm import Agent, build_system_prompt
    from server.stt import Transcriber
    from server.tts import KokoroTTS

    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    config = load_config()

    import httpx

    from server.settings import SettingsContext, SettingsStore

    ha = HomeAssistant(config.ha_url, config.ha_token)
    summary = await _startup_summary(ha)
    tools = build_ha_tools(ha)

    store = SettingsStore()
    overrides = store.load()
    model = overrides.get("model", config.lmstudio_model)
    voice = overrides.get("voice", config.tts_voice)
    sassy = bool(overrides.get("sassy", config.assistant_sassy))

    llm_client = AsyncOpenAI(base_url=config.lmstudio_url, api_key="lm-studio")
    agent = Agent(
        llm_client,
        model,
        tools,
        build_system_prompt(summary, sassy=sassy, name=config.assistant_name),
    )

    logger.info("loading STT model %s on %s", config.stt_model, config.stt_device)
    stt = Transcriber(config.stt_model, device=config.stt_device, language=config.stt_language)
    logger.info("loading Kokoro TTS (voice=%s)", voice)
    tts = KokoroTTS(voice=voice, lang_code=config.tts_lang_code)

    settings_ctx = SettingsContext(
        store=store,
        agent=agent,
        tts=tts,
        lmstudio_url=config.lmstudio_url,
        http=httpx.AsyncClient(timeout=10.0),
        summary=summary,
        sassy=sassy,
        name=config.assistant_name,
    )

    from server.chat import ChatStore
    from server.chat_routes import ChatContext

    chat_ctx = ChatContext(
        store=ChatStore(),
        client=llm_client,
        ha=ha,
        system_prompt=build_system_prompt(summary, sassy=sassy, name=config.assistant_name),
        default_model=lambda: agent.model,
        upload_dir=Path(__file__).resolve().parent.parent / "data" / "uploads",
        tools=tools,
    )
    settings_ctx.chat_ctx = chat_ctx
    app = create_app(
        stt,
        agent,
        tts,
        settings_ctx=settings_ctx,
        ha=ha,
        chat_ctx=chat_ctx,
        allowed_controls=config.allowed_controls,
        openai_stt_model=config.stt_model,
        openai_tts_model=config.tts_voice,
    )
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
