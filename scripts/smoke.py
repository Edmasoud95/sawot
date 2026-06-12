"""End-to-end smoke test: STT -> agent -> TTS with the real models.

Usage: python scripts/smoke.py path/to/speech-sample.wav
Record a sample with e.g.: arecord -f S16_LE -r 16000 -d 4 sample.wav
(or record in the web UI later). Writes the spoken reply to out.wav.
"""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openai import AsyncOpenAI

from server.config import load_config
from server.ha import HomeAssistant
from server.llm import Agent, build_system_prompt
from server.stt import Transcriber
from server.tts import KokoroTTS


async def main(wav_path: str) -> None:
    config = load_config()
    audio = Path(wav_path).read_bytes()

    t0 = time.perf_counter()
    stt = Transcriber(config.stt_model, device=config.stt_device)
    text = stt.transcribe(audio)
    t1 = time.perf_counter()
    print(f"[stt {t1 - t0:5.2f}s] {text!r}")
    if not text:
        sys.exit("transcription was empty")

    ha = HomeAssistant(config.ha_url, config.ha_token)
    await ha.load_areas()
    summary = await ha.entity_summary()
    client = AsyncOpenAI(base_url=config.lmstudio_url, api_key="lm-studio")
    agent = Agent(client, config.lmstudio_model, ha, build_system_prompt(summary))
    reply = await agent.run([], text)
    t2 = time.perf_counter()
    print(f"[llm {t2 - t1:5.2f}s] {reply!r}")

    tts = KokoroTTS(voice=config.tts_voice)
    wav = tts.synthesize(reply)
    t3 = time.perf_counter()
    Path("out.wav").write_bytes(wav)
    print(f"[tts {t3 - t2:5.2f}s] wrote out.wav ({len(wav)} bytes)")
    print(f"[total {t3 - t0:5.2f}s]")
    await ha.aclose()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))
