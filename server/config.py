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


# Environment variable -> path into the YAML document. The environment wins
# over the file, so a container can run with no config.yaml at all.
ENV_KEYS: dict[str, tuple[str, ...]] = {
    "HA_URL": ("home_assistant", "url"),
    "LM_STUDIO_URL": ("lm_studio", "url"),
    "LM_STUDIO_MODEL": ("lm_studio", "model"),
    "STT_MODEL": ("stt", "model"),
    "STT_LANGUAGE": ("stt", "language"),
    "TTS_VOICE": ("tts", "voice"),
    "TTS_LANG_CODE": ("tts", "lang_code"),
    "ASSISTANT_NAME": ("assistant", "name"),
    "ASSISTANT_PERSONALITY": ("assistant", "personality"),
    "SERVER_HOST": ("server", "host"),
    "SERVER_PORT": ("server", "port"),
    "TLS_CERTFILE": ("tls", "certfile"),
    "TLS_KEYFILE": ("tls", "keyfile"),
}

DEFAULTS = {
    ("lm_studio", "url"): "http://localhost:1234/v1",
    ("lm_studio", "model"): "",
    ("stt", "model"): "cohere-transcribe",
    ("stt", "language"): "en",
    ("tts", "voice"): "af_heart",
    ("tts", "lang_code"): "a",
    ("assistant", "name"): "Rita",
    ("assistant", "personality"): "sassy",
    ("server", "host"): "0.0.0.0",
    ("server", "port"): 8765,
}


def _read_yaml(path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def _as_mapping(source) -> dict:
    if isinstance(source, Mapping):
        return dict(source)
    return _read_yaml(source) if Path(source).exists() else {}


def _lookup(raw: Mapping, path: tuple[str, ...]):
    node = raw
    for key in path:
        if not isinstance(node, Mapping) or key not in node:
            return None
        node = node[key]
    return node


def load_config(
    source: str | Path | Mapping = "config.yaml",
    *,
    token: str | None = None,
    env: Mapping[str, str] | None = None,
) -> Config:
    """Load configuration from a YAML path or mapping, with environment
    variables (see ENV_KEYS) overriding the file. A missing file is fine when
    the environment supplies HA_URL and HA_TOKEN.

    This function is side-effect free: it does not load `.env` — call
    `load_dotenv()` at the entrypoint if you rely on that.
    """
    env = os.environ if env is None else env
    raw = _as_mapping(source)

    def get(path: tuple[str, ...]):
        for env_key, env_path in ENV_KEYS.items():
            if env_path == path and env.get(env_key):
                return env[env_key]
        value = _lookup(raw, path)
        return DEFAULTS.get(path) if value is None else value

    token = token or env.get("HA_TOKEN")
    if not token:
        raise RuntimeError("HA_TOKEN is not set (put it in .env or the environment)")
    ha_url = get(("home_assistant", "url"))
    if not ha_url:
        raise RuntimeError("HA_URL is not set (home_assistant.url in config.yaml or the HA_URL environment variable)")

    return Config(
        ha_url=str(ha_url).rstrip("/"),
        ha_token=token,
        lmstudio_url=str(get(("lm_studio", "url"))).rstrip("/"),
        lmstudio_model=str(get(("lm_studio", "model"))),
        stt_model=str(get(("stt", "model"))),
        stt_language=str(get(("stt", "language"))),
        tts_voice=str(get(("tts", "voice"))),
        tts_lang_code=str(get(("tts", "lang_code"))),
        assistant_name=str(get(("assistant", "name"))),
        assistant_sassy=get(("assistant", "personality")) != "plain",
        host=str(get(("server", "host"))),
        port=int(get(("server", "port"))),
        allowed_controls=raw.get("controls"),
        ssl_certfile=get(("tls", "certfile")),
        ssl_keyfile=get(("tls", "keyfile")),
    )
