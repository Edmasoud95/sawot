import json
from dataclasses import dataclass
from pathlib import Path

# Curated Kokoro voices exposed in the UI (full list lives in the model card).
KOKORO_VOICES = [
    "af_heart", "af_alloy", "af_bella", "af_nicole", "af_nova", "af_sky",
    "am_adam", "am_michael", "am_onyx",
    "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
]


class SettingsStore:
    """User-tunable runtime settings persisted to a JSON file.

    Values here override config.yaml defaults at startup."""

    def __init__(self, path: str | None = None):
        self._path = Path(path) if path else Path(__file__).resolve().parent.parent / "settings.json"

    def load(self) -> dict:
        try:
            if self._path.exists():
                return json.loads(self._path.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
        return {}

    def save(self, data: dict) -> None:
        self._path.write_text(json.dumps(data, indent=2))


@dataclass
class SettingsContext:
    """Everything the settings endpoints need, injected for testability."""

    store: SettingsStore
    agent: object
    tts: object
    lmstudio_url: str
    http: object  # httpx.AsyncClient
    summary: str = ""        # device list, needed to rebuild the system prompt
    chat_ctx: object = None  # ChatContext, so personality applies to chat too
    sassy: bool = True       # current personality state (sass on/off)
    name: str = "Rita"       # assistant name used to rebuild the system prompt
