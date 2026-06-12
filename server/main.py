import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("voice")

WEB_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"


def create_app(stt, agent, tts) -> FastAPI:
    app = FastAPI()

    @app.websocket("/ws")
    async def ws_endpoint(websocket: WebSocket):
        await websocket.accept()
        history: list[dict] = []
        try:
            while True:
                audio = await websocket.receive_bytes()
                text = await run_in_threadpool(stt.transcribe, audio)
                if not text:
                    await websocket.send_json(
                        {"type": "error", "message": "I didn't catch that"}
                    )
                    continue
                await websocket.send_json({"type": "transcript", "text": text})
                try:
                    reply = await agent.run(history, text)
                except Exception:
                    logger.exception("agent failure")
                    await websocket.send_json(
                        {"type": "error", "message": "LLM backend offline"}
                    )
                    continue
                await websocket.send_json({"type": "assistant_text", "text": reply})
                wav = await run_in_threadpool(tts.synthesize, reply)
                await websocket.send_bytes(wav)
        except WebSocketDisconnect:
            pass

    if WEB_DIR.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")

    return app


def main() -> None:
    import asyncio

    import uvicorn
    from openai import AsyncOpenAI

    from server.config import load_config
    from server.ha import HomeAssistant
    from server.llm import Agent, build_system_prompt
    from server.stt import Transcriber
    from server.tts import KokoroTTS

    logging.basicConfig(level=logging.INFO)
    config = load_config()

    ha = HomeAssistant(config.ha_url, config.ha_token)
    summary = asyncio.run(_startup_summary(ha))
    llm_client = AsyncOpenAI(base_url=config.lmstudio_url, api_key="lm-studio")
    agent = Agent(llm_client, config.lmstudio_model, ha, build_system_prompt(summary))

    logger.info("loading STT model %s on %s", config.stt_model, config.stt_device)
    stt = Transcriber(config.stt_model, device=config.stt_device)
    logger.info("loading Kokoro TTS (voice=%s)", config.tts_voice)
    tts = KokoroTTS(voice=config.tts_voice)

    app = create_app(stt, agent, tts)
    uvicorn.run(app, host=config.host, port=config.port)


async def _startup_summary(ha) -> str:
    try:
        await ha.load_areas()
        return await ha.entity_summary()
    except Exception:
        logger.exception("could not fetch entities from Home Assistant")
        return "(device list unavailable — use get_entities tool)"


if __name__ == "__main__":
    main()
