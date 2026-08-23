"""Model registry and download manager (Handy-style).

STT and TTS models are downloaded on demand into a project-local `models/`
directory. The registry lists each model with its HuggingFace source and an
approximate size; the recommended model for each kind is flagged for the UI.
"""

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from huggingface_hub import hf_hub_download, snapshot_download

from server.settings import KOKORO_VOICES

logger = logging.getLogger("voice.models")

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


@dataclass(frozen=True)
class ModelSpec:
    kind: str  # "stt" | "tts"
    id: str
    label: str
    repo: str
    size_mb: int
    recommended: bool = False
    description: str = ""
    files: tuple[str, ...] = ()  # for TTS: specific files; empty => full snapshot


STT_MODELS = [
    ModelSpec("stt", "tiny.en", "tiny.en", "Systran/faster-whisper-tiny.en", 75,
              description="Fastest; lowest accuracy"),
    ModelSpec("stt", "base.en", "base.en", "Systran/faster-whisper-base.en", 145,
              description="Fast, decent accuracy"),
    ModelSpec("stt", "small.en", "small.en", "Systran/faster-whisper-small.en", 465,
              description="Slower, more accurate"),
    ModelSpec("stt", "distil-small.en", "distil-small.en",
              "Systran/faster-distil-whisper-small.en", 300, recommended=True,
              description="Recommended — best speed/accuracy balance"),
    ModelSpec("stt", "medium.en", "medium.en", "Systran/faster-whisper-medium.en", 1500,
              description="High accuracy; more RAM"),
]

_KOKORO_FILES = ("config.json", "kokoro-v1_0.pth") + tuple(
    f"voices/{v}.pt" for v in KOKORO_VOICES
)

TTS_MODELS = [
    ModelSpec("tts", "kokoro", "Kokoro-82M", "hexgrad/Kokoro-82M", 327,
              recommended=True, description="Recommended local TTS",
              files=_KOKORO_FILES),
]


def all_models() -> list[ModelSpec]:
    return [*STT_MODELS, *TTS_MODELS]


def get_model(kind: str, model_id: str) -> ModelSpec | None:
    for spec in all_models():
        if spec.kind == kind and spec.id == model_id:
            return spec
    return None


def is_downloaded(spec: ModelSpec) -> bool:
    if spec.kind == "stt":
        return (MODELS_DIR / "stt" / spec.id / "model.bin").exists()
    if spec.kind == "tts":
        return (MODELS_DIR / "tts" / "kokoro-v1_0.pth").exists()
    return False


def _make_tqdm(on_update: Callable[[int, int], None] | None):
    """Minimal tqdm-compatible class for huggingface_hub progress callbacks."""

    class Shim:
        def __init__(self, total=None, **kwargs):
            self.total = int(total) if total is not None else 0
            self.n = 0
            if on_update:
                on_update(0, self.total)

        def update(self, n=1):
            self.n += int(n)
            if on_update:
                on_update(self.n, self.total)

        def close(self):
            pass

        def refresh(self):
            pass

        def set_description(self, *a, **k):
            pass

        def set_postfix(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return Shim


def download(spec: ModelSpec, on_update: Callable[[int, int], None] | None = None) -> None:
    """Download a model into the local `models/` directory (blocking)."""
    tqdm_cls = _make_tqdm(on_update) if on_update is not None else None
    if spec.kind == "stt":
        snapshot_download(
            repo_id=spec.repo,
            local_dir=str(MODELS_DIR / "stt" / spec.id),
            tqdm_class=tqdm_cls,
        )
    else:
        for filename in spec.files:
            hf_hub_download(
                repo_id=spec.repo,
                filename=filename,
                local_dir=str(MODELS_DIR / "tts"),
                tqdm_class=tqdm_cls,
            )


class ModelManager:
    """Tracks in-flight downloads so the UI can show live progress."""

    def __init__(self):
        self._running: dict[tuple[str, str], dict] = {}
        self._tasks: dict[tuple[str, str], asyncio.Task] = {}

    @staticmethod
    def _key(spec: ModelSpec) -> tuple[str, str]:
        return (spec.kind, spec.id)

    def status(self, spec: ModelSpec) -> dict:
        base = {
            "kind": spec.kind,
            "id": spec.id,
            "label": spec.label,
            "size_mb": spec.size_mb,
            "recommended": spec.recommended,
            "description": spec.description,
        }
        key = self._key(spec)
        if key in self._running:
            return {**base, **self._running[key]}
        state = "downloaded" if is_downloaded(spec) else "not_downloaded"
        return {**base, "state": state, "downloaded": 0, "total": 0, "error": None}

    def all_status(self) -> list[dict]:
        return [self.status(s) for s in all_models()]

    def start(self, spec: ModelSpec) -> bool:
        key = self._key(spec)
        if key in self._tasks and not self._tasks[key].done():
            return False  # already downloading
        self._running[key] = {
            "state": "downloading", "downloaded": 0, "total": 0, "error": None,
        }
        self._tasks[key] = asyncio.create_task(self._run(spec))
        return True

    async def _run(self, spec: ModelSpec) -> None:
        key = self._key(spec)
        self._running.setdefault(
            key, {"state": "downloading", "downloaded": 0, "total": 0, "error": None}
        )

        def on_update(done: int, total: int) -> None:
            self._running[key]["downloaded"] = done
            self._running[key]["total"] = total

        try:
            await asyncio.to_thread(download, spec, on_update)
            self._running[key]["state"] = "downloaded"
        except Exception as exc:
            logger.exception("model download failed: %s", spec.id)
            self._running[key]["state"] = "error"
            self._running[key]["error"] = str(exc)


manager = ModelManager()
