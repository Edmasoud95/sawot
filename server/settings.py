import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

# Curated Kokoro voices exposed in the UI (full list lives in the model card).
KOKORO_VOICES = [
    "af_heart", "af_alloy", "af_bella", "af_nicole", "af_nova", "af_sky",
    "am_adam", "am_michael", "am_onyx",
    "bf_emma", "bf_isabella", "bm_george", "bm_lewis",
]


def merge_settings(path: Path, patch: dict) -> None:
    """Serialize read/merge/atomic-write with the TypeScript settings writer."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = Path(str(path) + ".lock")
    deadline = time.monotonic() + 5
    while True:
        try:
            lock.mkdir(mode=0o700)
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise RuntimeError("Settings are busy. Retry; if this persists, stop SAWOT and remove settings.json.lock.") from None
            time.sleep(.01)
    temporary = None
    try:
        data = {}
        if path.exists():
            try:
                data = json.loads(path.read_text())
                if not isinstance(data, dict):
                    raise ValueError()
            except (OSError, ValueError):
                raise RuntimeError("Cannot read settings.json; restore or repair the file.") from None
        data.update(patch)
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, indent=2)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        lock.rmdir()


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
        merge_settings(self._path, data)


@dataclass
class SettingsContext:
    """Everything the settings endpoints need, injected for testability."""

    store: SettingsStore
    agent: object
    tts: object
    llm_url: str
    http: object  # httpx.AsyncClient
    summary: str = ""        # device list, needed to rebuild the system prompt
    chat_ctx: object = None  # ChatContext, so personality applies to chat too
    sassy: bool = True       # current personality state (sass on/off)
    name: str = "Rita"       # assistant name used to rebuild the system prompt
