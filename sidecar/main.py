"""Run the SAWOT inference sidecar (STT + TTS).

Usage:
    .venv/bin/python -m sidecar.main

Binds to 127.0.0.1 (loopback only) on port 8766 by default; override with the
SAWOT_SIDECAR_PORT environment variable.
"""

import asyncio
import logging
import os

from dotenv import load_dotenv

from sidecar.app import create_sidecar_app
from server.config import load_config
from server.stt import Transcriber
from server.tts import KokoroTTS


def main() -> None:
    asyncio.run(_main())


async def _main() -> None:
    import uvicorn

    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("sidecar")
    config = load_config()

    logger.info("loading STT model %s on %s", config.stt_model, config.stt_device)
    stt = Transcriber(config.stt_model, device=config.stt_device, language=config.stt_language)

    logger.info("loading Kokoro TTS (voice=%s)", config.tts_voice)
    tts = KokoroTTS(voice=config.tts_voice, lang_code=config.tts_lang_code)

    app = create_sidecar_app(
        stt,
        tts,
        openai_stt_model=config.stt_model,
        openai_tts_model=config.tts_voice,
    )
    port = int(os.environ.get("SAWOT_SIDECAR_PORT", "8766"))
    logger.info("sidecar listening on http://127.0.0.1:%d", port)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port))
    await server.serve()


if __name__ == "__main__":
    main()
