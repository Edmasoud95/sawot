import os
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import yaml


@dataclass
class Config:
    ha_url: str
    ha_token: str
    llm_url: str
    llm_model: str
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
    "LLM_URL": ("llm", "url"),
    "LLM_MODEL": ("llm", "model"),
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
    ("llm", "url"): "http://localhost:1234/v1",
    ("llm", "model"): "",
    ("stt", "model"): "parakeet-unified-en",
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
    using defaults. Home Assistant connection settings live in settings.json.

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

    base_dir = Path(".") if isinstance(source, Mapping) else Path(source).resolve().parent
    settings_path = Path(env.get("SAWOT_DATA_DIR", base_dir)) / "settings.json"
    saved = {}
    if (not isinstance(source, Mapping) or "SAWOT_DATA_DIR" in env) and settings_path.exists():
        try:
            saved = json.loads(settings_path.read_text())
            if not isinstance(saved, dict):
                raise ValueError()
        except (OSError, ValueError):
            raise RuntimeError("Cannot read settings.json; restore or repair the file.") from None
    if token is None:
        # Legacy fallback allows the sidecar to start before backend migration.
        token = saved.get("haToken", env.get("HA_TOKEN", ""))
    if not isinstance(token, str):
        raise RuntimeError("Invalid credential setting: haToken")
    ha_url = saved.get("haUrl", get(("home_assistant", "url")) or "")
    if not isinstance(ha_url, str):
        raise RuntimeError("Invalid connection setting: haUrl")

    return Config(
        ha_url=str(ha_url).rstrip("/"),
        ha_token=token,
        llm_url=str(get(("llm", "url"))).rstrip("/"),
        llm_model=str(get(("llm", "model"))),
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
