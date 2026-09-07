"""Run the SAWOT inference sidecar (STT + TTS).

Usage:
    .venv/bin/python -m sidecar.main

Binds to 127.0.0.1 (loopback only) on port 8766 by default; override with the
SAWOT_SIDECAR_PORT environment variable.
"""

import asyncio
import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from sidecar.app import create_sidecar_app
from server.config import load_config
from server.models import get_model, is_downloaded
from server.stt import make_stt_engine
from server.tts import make_tts_engine

SETTINGS_PATH = Path("settings.json")


def _override(kind: str) -> str | None:
    """Runtime-selected model from settings.json, if valid and downloaded."""
    try:
        model_id = json.loads(SETTINGS_PATH.read_text()).get(f"{kind}_model")
    except (OSError, ValueError):
        return None
    spec = get_model(kind, model_id) if model_id else None
    return model_id if spec and is_downloaded(spec) else None


def _persist(kind: str):
    """Write the selected model into settings.json, preserving the
    TypeScript backend's keys."""
    def write(model_id: str) -> None:
        try:
            data = json.loads(SETTINGS_PATH.read_text())
        except (OSError, ValueError):
            data = {}
        data[f"{kind}_model"] = model_id
        SETTINGS_PATH.write_text(json.dumps(data, indent=2))
    return write


_stt_override = lambda: _override("stt")  # noqa: E731 - kept for callers
_persist_stt = _persist("stt")


def main() -> None:
    asyncio.run(_main())


async def _main() -> None:
    import uvicorn

    load_dotenv()
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("sidecar")
    config = load_config()

    def stt_factory(model_id: str):
        return make_stt_engine(model_id, language=config.stt_language)

    stt_model = _stt_override() or config.stt_model
    logger.info("loading STT model %s", stt_model)
    stt = stt_factory(stt_model)

    def tts_factory(model_id: str):
        return make_tts_engine(model_id, voice=config.tts_voice, lang_code=config.tts_lang_code)

    tts_model = _override("tts") or "kokoro"
    logger.info("loading TTS model %s (voice=%s)", tts_model, config.tts_voice)
    tts = tts_factory(tts_model)

    app = create_sidecar_app(
        stt,
        tts,
        openai_stt_model=stt_model,
        tts_model=tts_model,
        stt_factory=stt_factory,
        persist_stt=_persist_stt,
        tts_factory=tts_factory,
        persist_tts=_persist("tts"),
    )
    port = int(os.environ.get("SAWOT_SIDECAR_PORT", "8766"))
    logger.info("sidecar listening on http://127.0.0.1:%d", port)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port))
    await server.serve()


if __name__ == "__main__":
    main()
