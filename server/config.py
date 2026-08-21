import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import yaml


@dataclass
class Config:
    ha_url: str
    ha_token: str
    lmstudio_url: str
    lmstudio_model: str
    stt_model: str
    stt_device: str
    stt_language: str
    tts_voice: str
    tts_lang_code: str
    assistant_name: str
    assistant_sassy: bool
    host: str
    port: int
    allowed_controls: dict[str, list[str]] | None = None
    ssl_certfile: str | None = None
    ssl_keyfile: str | None = None


def _read_yaml(path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def _as_mapping(source) -> dict:
    return source if isinstance(source, Mapping) else _read_yaml(source)


def load_config(
    source: str | Path | Mapping = "config.yaml",
    *,
    token: str | None = None,
) -> Config:
    """Load configuration from a YAML path or an already-parsed mapping.

    The HA token comes from the `token` argument or the `HA_TOKEN`
    environment variable. This function is side-effect free: it does not load
    `.env` — call `load_dotenv()` at the entrypoint if you rely on that.
    """
    raw = _as_mapping(source)
    token = token or os.environ.get("HA_TOKEN")
    if not token:
        raise RuntimeError("HA_TOKEN is not set (put it in .env)")

    assistant = raw.get("assistant") or {}
    personality = assistant.get("personality", "sassy")

    return Config(
        ha_url=raw["home_assistant"]["url"].rstrip("/"),
        ha_token=token,
        lmstudio_url=raw["lm_studio"]["url"].rstrip("/"),
        lmstudio_model=raw["lm_studio"]["model"],
        stt_model=raw["stt"]["model"],
        stt_device=raw["stt"].get("device", "cuda"),
        stt_language=raw["stt"].get("language", "en"),
        tts_voice=raw["tts"]["voice"],
        tts_lang_code=raw["tts"].get("lang_code", "a"),
        assistant_name=assistant.get("name", "Rita"),
        assistant_sassy=personality != "plain",
        host=raw["server"].get("host", "0.0.0.0"),
        port=int(raw["server"].get("port", 8765)),
        allowed_controls=raw.get("controls"),
        ssl_certfile=(raw.get("tls") or {}).get("certfile"),
        ssl_keyfile=(raw.get("tls") or {}).get("keyfile"),
    )
