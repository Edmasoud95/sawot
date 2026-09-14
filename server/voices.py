"""Voice cloning for Chatterbox: record a short passage in Settings, and it
becomes a reference clip in models/tts/voices/<name>.wav that the engine
picks up at once under that name."""

import re

import numpy as np
import soundfile as sf
from fastapi import File, Form, HTTPException, UploadFile

from server.stt import decode_to_pcm
from server.tts import voices_dir

REFERENCE_SR = 24000     # what Chatterbox's decoder conditions on
TARGET_LUFS = -27.0      # Chatterbox's own reference level
MIN_SECONDS = 5.5        # Chatterbox refuses reference clips of 5 s or less
MAX_SECONDS = 15.0       # Chatterbox reads no more than this anyway
NAME_MAX = 40
_NAME_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _'\-]*$")


def prepare_reference(audio: bytes) -> tuple[np.ndarray, int]:
    """Decode a browser recording to mono 24 kHz, cut the silence around the
    speech, and cap the length. Raises ValueError for unusable audio."""
    try:
        pcm = decode_to_pcm(audio, REFERENCE_SR)
    except RuntimeError as exc:
        raise ValueError(f"could not decode the recording: {exc}") from exc
    pcm = np.asarray(pcm, dtype=np.float32)
    # Trim leading/trailing silence: anything under -40 dBFS relative to peak.
    peak = float(np.abs(pcm).max()) if pcm.size else 0.0
    if peak > 0:
        loud = np.flatnonzero(np.abs(pcm) > peak * 0.01)
        pad = int(0.1 * REFERENCE_SR)
        pcm = pcm[max(0, loud[0] - pad):min(len(pcm), loud[-1] + pad)]
    if len(pcm) < MIN_SECONDS * REFERENCE_SR:
        raise ValueError(f"the recording needs at least {MIN_SECONDS:.0f} seconds of speech — read the whole passage")
    return normalize_loudness(pcm[: int(MAX_SECONDS * REFERENCE_SR)]), REFERENCE_SR


def normalize_loudness(pcm: np.ndarray, target_lufs: float = TARGET_LUFS) -> np.ndarray:
    """Bring the clip to Chatterbox's reference level, staying in float32.
    The engine's own step is skipped (see ChatterboxTTS.synthesize)."""
    try:
        import pyloudnorm as ln
        loudness = ln.Meter(REFERENCE_SR).integrated_loudness(pcm)
        gain = float(10.0 ** ((target_lufs - loudness) / 20.0))
    except Exception:  # noqa: BLE001 - no pyloudnorm, or silence: fall back to peak
        peak = float(np.abs(pcm).max()) if pcm.size else 0.0
        gain = 0.5 / peak if peak > 0 else 1.0
    if not np.isfinite(gain) or gain <= 0:
        return pcm
    out = (pcm * np.float32(gain)).astype(np.float32, copy=False)
    peak = float(np.abs(out).max()) if out.size else 0.0
    return out / np.float32(peak / 0.99) if peak > 0.99 else out


def clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not name or len(name) > NAME_MAX or not _NAME_OK.match(name):
        raise ValueError(f"voice names are 1-{NAME_MAX} letters, digits, spaces, dashes or apostrophes")
    if name.lower() == "default":
        raise ValueError("'default' is the built-in voice")
    return name


def cloned_voices() -> list[str]:
    """Every saved clone, whichever engine is active (only Chatterbox speaks them)."""
    folder = voices_dir()
    return sorted(p.stem for p in folder.glob("*.wav")) if folder.exists() else []


def voice_listing(state) -> dict:
    engine = getattr(state, "tts", None)
    voices = list(engine.voices()) if engine is not None and hasattr(engine, "voices") else []
    default = getattr(engine, "default_voice", voices[0] if voices else None)
    return {"engine": getattr(state, "tts_model", None), "voices": voices, "default": default, "clones": cloned_voices()}


def register_voice_routes(app, state) -> None:
    def listing() -> dict:
        return voice_listing(state)

    @app.post("/api/voices")
    async def clone_voice(name: str = Form(""), file: UploadFile = File(...)):
        try:
            voice = clean_name(name)
            pcm, sr = prepare_reference(await file.read())
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        folder = voices_dir()
        folder.mkdir(parents=True, exist_ok=True)
        sf.write(folder / f"{voice}.wav", pcm, sr, format="WAV")
        return {"voice": voice, **listing()}

    @app.delete("/api/voices/{name}")
    async def delete_voice(name: str):
        if name.lower() == "default":
            raise HTTPException(400, "the built-in voice cannot be removed")
        try:
            path = voices_dir() / f"{clean_name(name)}.wav"
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        if not path.exists():
            raise HTTPException(404, f"no cloned voice named {name}")
        path.unlink()
        return listing()
