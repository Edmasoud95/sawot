import json
import logging
import time

logger = logging.getLogger("voice.llm")

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_entities",
            "description": (
                "List Home Assistant entities with their current state. "
                "Filter by domain (e.g. 'light', 'switch', 'climate') "
                "and/or area name (e.g. 'Kitchen')."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "Entity domain filter"},
                    "area": {"type": "string", "description": "Area name filter"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "call_service",
            "description": (
                "Call a Home Assistant service to control a device, e.g. "
                "domain='light', service='turn_on', entity_id='light.kitchen', "
                "data={'brightness_pct': 50}."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "service": {"type": "string"},
                    "entity_id": {"type": "string"},
                    "data": {
                        "type": "object",
                        "description": "Optional extra service data",
                    },
                },
                "required": ["domain", "service", "entity_id"],
            },
        },
    },
]

_SYSTEM_TEMPLATE = """You are a friendly voice assistant for a smart home, \
speaking with the user out loud. Keep replies short, natural and speakable — \
one or two sentences, no markdown, no lists, no emojis.

You control Home Assistant devices with the provided tools. Use the device \
list below to pick entity_ids directly; only call get_entities if the list \
is insufficient. The list contains only controllable devices — readings such \
as temperature, humidity or power are NOT listed; fetch those with \
get_entities(domain='sensor', area=...), and pick the matching sensor from \
the result. After acting, confirm briefly what you did. If something fails, \
say so plainly. You may also answer general questions conversationally.

Devices:
{summary}"""


def build_system_prompt(entity_summary: str) -> str:
    return _SYSTEM_TEMPLATE.format(summary=entity_summary)


def _touched_ids(name: str, args: dict, result) -> list[str]:
    if isinstance(result, dict) and "error" in result:
        return []
    if name == "call_service":
        eid = args.get("entity_id")
        return [eid] if eid else []
    if name == "get_entities":
        items = result.get("entities") if isinstance(result, dict) else result
        if isinstance(items, list):
            return [
                e["entity_id"]
                for e in items
                if isinstance(e, dict) and "entity_id" in e
            ]
    return []


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
    """Runs the chat + tool-calling loop against an OpenAI-compatible LLM."""

    MAX_ROUNDS = 5

    def __init__(self, client, model: str, ha, system_prompt: str):
        self._client = client
        self._model = model
        self._ha = ha
        self._system = system_prompt

    @property
    def model(self) -> str:
        return self._model

    def set_model(self, model: str) -> None:
        self._model = model

    async def run(self, history: list[dict], user_text: str, on_event=None) -> str:
        emit = _safe_emitter(on_event)
        history.append({"role": "user", "content": user_text})
        for round_no in range(1, self.MAX_ROUNDS + 1):
            t0 = time.perf_counter()
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "system", "content": self._system}, *history],
                tools=TOOLS,
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
                    result = await self._execute(tc.function.name, args)
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
                ids = _touched_ids(tc.function.name, args, result)
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

    MAX_TOOL_ENTITIES = 60

    async def _execute(self, name: str, args: dict):
        try:
            if name == "get_entities":
                entities = await self._ha.get_entities(
                    args.get("domain"), args.get("area")
                )
                if len(entities) > self.MAX_TOOL_ENTITIES:
                    return {
                        "entities": entities[: self.MAX_TOOL_ENTITIES],
                        "note": (
                            f"{len(entities) - self.MAX_TOOL_ENTITIES} more omitted — "
                            "narrow the query with domain and/or area"
                        ),
                    }
                return entities
            if name == "call_service":
                return await self._ha.call_service(
                    args["domain"], args["service"], args["entity_id"], args.get("data")
                )
            return {"error": f"unknown tool: {name}"}
        except Exception as exc:  # surfaced to the model so it can apologize
            return {"error": str(exc)}
