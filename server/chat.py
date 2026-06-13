import json
import time
import uuid
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent


class ChatStore:
    """One JSON file per conversation under data/conversations/."""

    def __init__(self, root: str | None = None):
        self._root = Path(root) if root else _PROJECT_ROOT / "data" / "conversations"
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, cid: str) -> Path:
        return self._root / f"{cid}.json"

    def create(self, model: str) -> dict:
        now = time.time()
        conv = {
            "id": uuid.uuid4().hex[:12],
            "title": "New chat",
            "model": model,
            "created": now,
            "updated": now,
            "messages": [],
        }
        self.save(conv)
        return conv

    def get(self, cid: str) -> dict | None:
        path = self._path(cid)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def save(self, conv: dict) -> None:
        self._path(conv["id"]).write_text(json.dumps(conv, indent=2))

    def delete(self, cid: str) -> None:
        self._path(cid).unlink(missing_ok=True)

    def list(self) -> list[dict]:
        out = []
        for path in self._root.glob("*.json"):
            try:
                conv = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            out.append({k: conv[k] for k in ("id", "title", "model", "created", "updated")})
        return sorted(out, key=lambda c: c["updated"], reverse=True)
