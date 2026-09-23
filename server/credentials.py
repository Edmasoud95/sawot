"""Read model-download credentials without exposing them in API responses."""
import json
import os
from pathlib import Path


def hugging_face_token() -> str | bool | None:
    path = Path(os.environ.get("SAWOT_DATA_DIR") or Path(__file__).resolve().parent.parent) / "settings.json"
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if not isinstance(data, dict):
                raise ValueError()
        except (OSError, ValueError):
            raise RuntimeError("Cannot read settings.json; restore or repair the file.") from None
        if "hfToken" in data:
            if not isinstance(data["hfToken"], str):
                raise RuntimeError("Invalid credential setting: hfToken")
            # False suppresses both environment and cached login tokens after removal.
            return data["hfToken"] or False
    # Legacy environment / hf auth login support before backend migration.
    return None
