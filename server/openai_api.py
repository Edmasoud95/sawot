"""OpenAI-compatible audio endpoints over the local STT/TTS engines.

Exposes POST /v1/audio/speech (Kokoro TTS) and POST /v1/audio/transcriptions
(transcribe.cpp STT) plus GET /v1/models, so OpenAI SDK clients can point at
SAWOT as a drop-in local speech backend.
"""

import asyncio
import subprocess

from fastapi import File, Form, HTTPException, UploadFile

from server.stt import ModelNotDownloaded
from fastapi.responses import Response

# response_format -> (ffmpeg output format, media type). "wav" is native.
_FFMPEG_FMTS = {
    "wav": ("wav", "audio/wav"),
    "mp3": ("mp3", "audio/mpeg"),
    "opus": ("opus", "audio/ogg"),
    "aac": ("adts", "audio/aac"),
    "flac": ("flac", "audio/flac"),
    "pcm": ("s16le", "audio/pcm"),
}


def _convert(wav: bytes, fmt: str, speed: float) -> bytes:
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0"]
    if speed != 1.0:
        cmd += ["-filter:a", f"atempo={speed}"]
    cmd += ["-f", _FFMPEG_FMTS[fmt][0], "pipe:1"]
    proc = subprocess.run(cmd, input=wav, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace")[:300])
    return proc.stdout


def register_openai_api(app, state) -> None:
    """Register the audio endpoints against a mutable engine `state` (an
    object with .stt/.tts engines and .stt_model/.tts_model ids), so a
    runtime STT model swap is picked up without re-registering routes."""
    @app.post("/v1/audio/speech")
    async def create_speech(body: dict):
        text = body.get("input")
        if not text or not isinstance(text, str):
            raise HTTPException(400, "missing or invalid 'input'")
        voice = body.get("voice")
        fmt = body.get("response_format", "mp3")
        try:
            speed = float(body.get("speed", 1.0))
        except (TypeError, ValueError):
            raise HTTPException(400, "invalid 'speed'")
        if not 0.5 <= speed <= 2.0:
            raise HTTPException(400, "speed must be between 0.5 and 2.0")
        if fmt not in _FFMPEG_FMTS:
            raise HTTPException(400, f"unsupported response_format: {fmt}")

        try:
            if voice is not None:
                wav = await asyncio.to_thread(state.tts.synthesize, text, voice)
            else:
                wav = await asyncio.to_thread(state.tts.synthesize, text)
        except ModelNotDownloaded as exc:
            raise HTTPException(503, str(exc))

        if fmt == "wav" and speed == 1.0:
            return Response(content=wav, media_type="audio/wav")
        try:
            audio = await asyncio.to_thread(_convert, wav, fmt, speed)
        except (RuntimeError, FileNotFoundError) as exc:
            raise HTTPException(500, f"audio conversion failed (ffmpeg required): {exc}")
        return Response(content=audio, media_type=_FFMPEG_FMTS[fmt][1])

    @app.post("/v1/audio/transcriptions")
    async def create_transcription(
        file: UploadFile = File(...),
        model: str = Form("whisper-1"),
        language: str | None = Form(None),
        response_format: str = Form("json"),
    ):
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty audio file")
        try:
            text = await asyncio.to_thread(state.stt.transcribe, data, language=language)
        except ModelNotDownloaded as exc:
            raise HTTPException(503, str(exc))
        if response_format == "text":
            return Response(content=text, media_type="text/plain")
        if response_format == "verbose_json":
            return {"text": text, "language": language or "en", "duration": 0.0, "segments": []}
        if response_format in ("json", "json_object"):
            return {"text": text}
        raise HTTPException(400, f"unsupported response_format: {response_format}")

    @app.get("/v1/models")
    async def list_models():
        return {
            "object": "list",
            "data": [
                {"id": state.stt_model, "object": "model", "created": 0, "owned_by": "sawot"},
                {"id": state.tts_model, "object": "model", "created": 0, "owned_by": "sawot"},
            ],
        }
