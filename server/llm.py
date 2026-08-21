import json
import logging
import time

from server.tools import execute_tool, to_openai_tools, touched_ids_for

logger = logging.getLogger("voice.llm")

_INTRO_SASSY = "You are {name}, a sassy voice assistant for a smart home, "
_INTRO_PLAIN = "You are {name}, a friendly voice assistant for a smart home, "

_INTRO_TAIL = """speaking with the user out loud. Keep replies short, natural \
and speakable — one or two sentences, no markdown, no lists, no emojis."""

_PERSONA = """

You have personality: you're witty, a little sarcastic, and you tease the user \
while still getting the job done. After doing a chore for them you might quip \
something like "Next time do it yourself." When the user asks you to control or \
find something that doesn't exist, don't just say you can't — be playfully \
incredulous, e.g. "Hmm, interesting. Is that thing in the room with us right \
now? Want me to help you book a psychiatrist appointment instead?" Keep the \
sass light and good-natured; never be genuinely mean, and always still help."""

_FUNCTIONAL = """

You control Home Assistant devices with the provided tools. Use the device \
list below to pick entity_ids directly when acting. The list's states are a \
snapshot and may be stale — when the user asks about a device's current \
state, check it live with get_entities instead of answering from the list. \
The list contains only controllable devices — readings such as temperature, \
humidity or power are NOT listed; fetch those with \
get_entities(domain='sensor', area=...), and pick the matching sensor from \
the result. After acting, confirm briefly what you did. If something fails, \
say so plainly. You may also answer general questions conversationally.

Devices:
{summary}"""


def build_system_prompt(entity_summary: str, sassy: bool = True, name: str = "Rita") -> str:
    intro = (_INTRO_SASSY if sassy else _INTRO_PLAIN).format(name=name)
    persona = _PERSONA if sassy else ""
    template = intro + _INTRO_TAIL + persona + _FUNCTIONAL
    return template.format(summary=entity_summary)


def _truncate(s: str, limit: int = 600) -> str:
    """Cap tool results in debug events so traces stay small."""
    return s if len(s) <= limit else s[:limit] + "…"


def _safe_emitter(on_event):
    """Wrap an optional debug callback so observer failures never break a turn."""

    async def emit(event: str, data: dict) -> None:
        if on_event is None:
            return
        try:
            await on_event(event, data)
        except Exception:
            logger.debug("debug event emission failed", exc_info=True)

    return emit


class Agent:
    """Runs the chat + tool-calling loop against an OpenAI-compatible LLM.

    Backend-agnostic: tool schemas and handlers are injected as a list of
    `Tool` objects (see server.tools / server.ha_tools)."""

    MAX_ROUNDS = 5

    def __init__(self, client, model: str, tools, system_prompt: str):
        self._client = client
        self._model = model
        self._tools = tools
        self._system = system_prompt

    @property
    def model(self) -> str:
        return self._model

    def set_model(self, model: str) -> None:
        self._model = model

    def set_system_prompt(self, system_prompt: str) -> None:
        self._system = system_prompt

    async def run(self, history: list[dict], user_text: str, on_event=None) -> str:
        emit = _safe_emitter(on_event)
        history.append({"role": "user", "content": user_text})
        for round_no in range(1, self.MAX_ROUNDS + 1):
            t0 = time.perf_counter()
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "system", "content": self._system}, *history],
                tools=to_openai_tools(self._tools),
            )
            msg = response.choices[0].message
            await emit(
                "llm_round",
                {
                    "round": round_no,
                    "latency_ms": round((time.perf_counter() - t0) * 1000),
                    "tool_calls": (
                        [tc.function.name for tc in msg.tool_calls]
                        if msg.tool_calls
                        else None
                    ),
                },
            )
            if not msg.tool_calls:
                reply = (msg.content or "").strip()
                history.append({"role": "assistant", "content": reply})
                return reply
            history.append(
                {
                    "role": "assistant",
                    "content": msg.content,
                    "tool_calls": [tc.model_dump() for tc in msg.tool_calls],
                }
            )
            for tc in msg.tool_calls:
                t1 = time.perf_counter()
                args: dict = {}
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError as exc:
                    await emit(
                        "tool_call",
                        {"name": tc.function.name, "args": tc.function.arguments},
                    )
                    result = {"error": f"invalid tool arguments: {exc}"}
                else:
                    await emit("tool_call", {"name": tc.function.name, "args": args})
                    result = await execute_tool(self._tools, tc.function.name, args)
                content = json.dumps(result)
                await emit(
                    "tool_result",
                    {
                        "name": tc.function.name,
                        "latency_ms": round((time.perf_counter() - t1) * 1000),
                        "size_chars": len(content),
                        "result": _truncate(content),
                    },
                )
                ids = touched_ids_for(self._tools, tc.function.name, args, result)
                if ids:
                    await emit("touched", {"entity_ids": ids})
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": content,
                    }
                )
        reply = "Sorry, I couldn't complete that."
        history.append({"role": "assistant", "content": reply})
        return reply
