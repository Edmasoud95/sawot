"""Reusable voice turn: STT -> agent -> TTS, framework-agnostic."""

import asyncio
import logging
import time

logger = logging.getLogger("voice.pipeline")


async def run_voice_turn(stt, agent, tts, audio: bytes, history: list[dict], *, send, get_cards=None) -> None:
    """Run one push-to-talk turn and report progress through `send(kind, payload)`.

    `send` receives:
      - ("debug", {"event": str, "data": dict})
      - ("transcript", {"text": str})
      - ("assistant_text", {"text": str})
      - ("entities", {"entities": list})
      - ("error", {"message": str})
      - ("wav", bytes)

    `history` is mutated in place and rolled back if the agent fails.
    """
    t0 = time.perf_counter()
    text = await asyncio.to_thread(stt.transcribe, audio)
    await send(
        "debug",
        {"event": "stt", "data": {"text": text, "latency_ms": round((time.perf_counter() - t0) * 1000)}},
    )
    if not text:
        await send("error", {"message": "I didn't catch that"})
        return
    await send("transcript", {"text": text})

    touched: list[str] = []

    async def on_agent_event(event: str, data: dict) -> None:
        if event == "touched":
            for eid in data.get("entity_ids", []):
                if eid not in touched:
                    touched.append(eid)
            return
        await send("debug", {"event": event, "data": data})

    checkpoint = len(history)
    try:
        reply = await agent.run(history, text, on_event=on_agent_event)
    except Exception:
        logger.exception("agent failure")
        del history[checkpoint:]
        await send("error", {"message": "LLM backend offline"})
        return

    await send("assistant_text", {"text": reply})
    if get_cards is not None and touched:
        try:
            cards = await get_cards(touched[:8])
            await send("entities", {"entities": cards})
        except Exception:
            logger.exception("entities refresh failed")

    t1 = time.perf_counter()
    wav = await asyncio.to_thread(tts.synthesize, reply)
    await send(
        "debug",
        {"event": "tts", "data": {"latency_ms": round((time.perf_counter() - t1) * 1000), "bytes": len(wav)}},
    )
    await send("wav", wav)
