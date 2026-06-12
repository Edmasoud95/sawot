import json

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
is insufficient. After acting, confirm briefly what you did. If something \
fails, say so plainly. You may also answer general questions conversationally.

Devices:
{summary}"""


def build_system_prompt(entity_summary: str) -> str:
    return _SYSTEM_TEMPLATE.format(summary=entity_summary)


class Agent:
    """Runs the chat + tool-calling loop against an OpenAI-compatible LLM."""

    MAX_ROUNDS = 5

    def __init__(self, client, model: str, ha, system_prompt: str):
        self._client = client
        self._model = model
        self._ha = ha
        self._system = system_prompt

    async def run(self, history: list[dict], user_text: str) -> str:
        history.append({"role": "user", "content": user_text})
        for _ in range(self.MAX_ROUNDS):
            response = await self._client.chat.completions.create(
                model=self._model,
                messages=[{"role": "system", "content": self._system}, *history],
                tools=TOOLS,
            )
            msg = response.choices[0].message
            if not msg.tool_calls:
                reply = msg.content or ""
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
                result = await self._execute(
                    tc.function.name, json.loads(tc.function.arguments or "{}")
                )
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result),
                    }
                )
        return "Sorry, I couldn't complete that."

    async def _execute(self, name: str, args: dict):
        try:
            if name == "get_entities":
                return await self._ha.get_entities(args.get("domain"), args.get("area"))
            if name == "call_service":
                return await self._ha.call_service(
                    args["domain"], args["service"], args["entity_id"], args.get("data")
                )
            return {"error": f"unknown tool: {name}"}
        except Exception as exc:  # surfaced to the model so it can apologize
            return {"error": str(exc)}
