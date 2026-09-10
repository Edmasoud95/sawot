"""Model registry and download manager (Handy-style).

STT and TTS models are downloaded on demand into a project-local `models/`
directory. The registry lists each model with its HuggingFace source and an
approximate size; the recommended model for each kind is flagged for the UI.
"""

import os
import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from huggingface_hub import hf_hub_download, snapshot_download

from server.settings import KOKORO_VOICES

logger = logging.getLogger("voice.models")

# Models live under SAWOT_DATA_DIR when set (the Docker volume), else the repo.
MODELS_DIR = Path(os.environ.get("SAWOT_DATA_DIR") or Path(__file__).resolve().parent.parent) / "models"


@dataclass(frozen=True)
class ModelSpec:
    kind: str  # "stt" | "tts"
    id: str
    label: str
    repo: str
    size_mb: int
    recommended: bool = False
    description: str = ""
    files: tuple[str, ...] = ()  # specific files; empty => full snapshot


# All STT models are quantized GGUFs from Handy's catalog, run by
# transcribe.cpp on CPU (or Vulkan when available) — no CUDA required.
STT_MODELS = [
    ModelSpec("stt", "cohere-transcribe", "Cohere Transcribe",
              "handy-computer/cohere-transcribe-03-2026-gguf", 1560, recommended=True,
              description="Recommended — top accuracy, 14 languages",
              files=("cohere-transcribe-03-2026-Q4_K_M.gguf",)),
    ModelSpec("stt", "parakeet-unified-en", "Parakeet Unified EN 0.6B",
              "handy-computer/parakeet-unified-en-0.6b-gguf", 731,
              description="Very fast; English only",
              files=("parakeet-unified-en-0.6b-Q8_0.gguf",)),
    ModelSpec("stt", "parakeet-tdt-v3", "Parakeet TDT 0.6B v3",
              "handy-computer/parakeet-tdt-0.6b-v3-gguf", 740,
              description="Fast; 25 European languages",
              files=("parakeet-tdt-0.6b-v3-Q8_0.gguf",)),
    ModelSpec("stt", "whisper-large-v3-turbo", "Whisper Large v3 Turbo",
              "handy-computer/whisper-large-v3-turbo-gguf", 886,
              description="Multilingual all-rounder (~100 languages)",
              files=("whisper-large-v3-turbo-Q8_0.gguf",)),
    ModelSpec("stt", "canary-180m-flash", "Canary 180M Flash",
              "handy-computer/canary-180m-flash-gguf", 218,
              description="Smallest and fastest; en, de, es, fr",
              files=("canary-180m-flash-Q8_0.gguf",)),
]

_KOKORO_FILES = ("config.json", "kokoro-v1_0.pth") + tuple(
    f"voices/{v}.pt" for v in KOKORO_VOICES
)

# Chatterbox Turbo and Nano share one architecture; each repo also ships a
# legacy decoder (s3gen.safetensors) that the loader never reads, so it is
# skipped. conds.pt is the built-in voice used when no reference clip is set.
_CHATTERBOX_COMMON = ("ve.safetensors", "s3gen_meanflow.safetensors", "conds.pt",
                      "tokenizer_config.json", "vocab.json", "merges.txt",
                      "added_tokens.json", "special_tokens_map.json")

TTS_MODELS = [
    ModelSpec("tts", "kokoro", "Kokoro-82M", "hexgrad/Kokoro-82M", 327,
              recommended=True, description="Recommended local TTS",
              files=_KOKORO_FILES),
    ModelSpec("tts", "chatterbox-turbo", "Chatterbox Turbo", "ResembleAI/chatterbox-turbo", 3050,
              description="Expressive, low latency; supports [laugh] tags and voice clips; GPU",
              files=_CHATTERBOX_COMMON + ("t3_turbo_v1.safetensors", "t3_turbo_v1.yaml")),
    ModelSpec("tts", "chatterbox-nano", "Chatterbox Nano", "ResembleAI/chatterbox-nano", 2050,
              description="Small Chatterbox for CPU or GPU; same tags and voice clips",
              files=_CHATTERBOX_COMMON + ("t3_nano_v1.safetensors", "t3_nano_v1.yaml")),
]


def tts_dir(spec: ModelSpec) -> Path:
    """Kokoro keeps its historical flat layout; other TTS models get a folder."""
    return MODELS_DIR / "tts" if spec.id == "kokoro" else MODELS_DIR / "tts" / spec.id


def all_models() -> list[ModelSpec]:
    return [*STT_MODELS, *TTS_MODELS]


def get_model(kind: str, model_id: str) -> ModelSpec | None:
    for spec in all_models():
        if spec.kind == kind and spec.id == model_id:
            return spec
    return None


def is_downloaded(spec: ModelSpec) -> bool:
    if spec.kind == "stt":
        return any((MODELS_DIR / "stt" / spec.id).glob("*.gguf"))
    if spec.kind == "tts":
        if spec.id == "kokoro":
            return (MODELS_DIR / "tts" / "kokoro-v1_0.pth").exists()
        folder = tts_dir(spec)
        weights = [f for f in spec.files if f.endswith(".safetensors")]
        return all((folder / f).exists() for f in weights)
    return False


def _make_tqdm(on_update: Callable[[int, int], None] | None):
    """tqdm subclass that reports progress through a callback.

    Subclassing (rather than reimplementing) keeps huggingface_hub's usage
    compatible — including thread_map's ensure_lock/get_lock/set_lock and the
    iterable-wrapping constructor.
    """
    from tqdm import tqdm as _tqdm

    class Shim(_tqdm):
        def update(self, n=1):
            super().update(n)
            if on_update:
                on_update(self.n, self.total or 0)

    return Shim


def download(spec: ModelSpec, on_update: Callable[[int, int], None] | None = None) -> None:
    """Download a model into the local `models/` directory (blocking)."""
    tqdm_cls = _make_tqdm(on_update) if on_update is not None else None
    target = tts_dir(spec) if spec.kind == "tts" else MODELS_DIR / f"stt/{spec.id}"
    try:
        if spec.files:
            # Specific files only — e.g. one GGUF quant out of a repo of many.
            for filename in spec.files:
                hf_hub_download(
                    repo_id=spec.repo,
                    filename=filename,
                    local_dir=str(target),
                    tqdm_class=tqdm_cls,
                )
        else:
            snapshot_download(
                repo_id=spec.repo,
                local_dir=str(target),
                tqdm_class=tqdm_cls,
            )
    except Exception as exc:
        msg = str(exc)
        if "gated" in msg.lower() or "403" in msg:
            raise RuntimeError(
                f"This model is gated on Hugging Face: accept access at "
                f"https://huggingface.co/{spec.repo} while signed in, make the "
                f"token available (`hf auth login` or HF_TOKEN in .env), then retry."
            ) from exc
        raise


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
