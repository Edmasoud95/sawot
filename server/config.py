import os
from dataclasses import dataclass

import yaml
from dotenv import load_dotenv


@dataclass
class Config:
    ha_url: str
    ha_token: str
    lmstudio_url: str
    lmstudio_model: str
    stt_model: str
    stt_device: str
    tts_voice: str
    host: str
    port: int
    ssl_certfile: str | None = None
    ssl_keyfile: str | None = None


def load_config(path: str = "config.yaml") -> Config:
    load_dotenv()
    with open(path) as f:
        raw = yaml.safe_load(f)
    token = os.environ.get("HA_TOKEN")
    if not token:
        raise RuntimeError("HA_TOKEN is not set (put it in .env)")
    return Config(
        ha_url=raw["home_assistant"]["url"].rstrip("/"),
        ha_token=token,
        lmstudio_url=raw["lm_studio"]["url"],
        lmstudio_model=raw["lm_studio"]["model"],
        stt_model=raw["stt"]["model"],
        stt_device=raw["stt"].get("device", "cuda"),
        tts_voice=raw["tts"]["voice"],
        host=raw["server"].get("host", "0.0.0.0"),
        port=int(raw["server"].get("port", 8765)),
        ssl_certfile=(raw.get("tls") or {}).get("certfile"),
        ssl_keyfile=(raw.get("tls") or {}).get("keyfile"),
    )
