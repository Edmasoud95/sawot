"""Reusable tool registry.

Decouples the LLM agent from any specific backend: an agent consumes a list of
`Tool` objects, each carrying its OpenAI function-calling schema and an async
handler. Home Assistant tools are one provided implementation (see ha_tools).
"""

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

ToolHandler = Callable[[dict], Awaitable[dict]]
TouchedIdsFn = Callable[[dict, Any], list[str]]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict  # JSON Schema for the arguments
    handler: ToolHandler
    touched_ids: TouchedIdsFn | None = None

    def openai_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


def to_openai_tools(tools: list[Tool]) -> list[dict]:
    """Build the `tools` list passed to an OpenAI-compatible chat completion."""
    return [t.openai_schema() for t in tools]


async def execute_tool(tools: list[Tool], name: str, args: dict) -> dict:
    """Dispatch a tool call to its handler; errors become results for the model."""
    for tool in tools:
        if tool.name == name:
            try:
                return await tool.handler(args)
            except Exception as exc:  # surfaced to the model so it can react
                return {"error": str(exc)}
    return {"error": f"unknown tool: {name}"}


def touched_ids_for(tools: list[Tool], name: str, args: dict, result: Any) -> list[str]:
    """Entity ids a tool result touched, so the UI can refresh device cards."""
    if isinstance(result, dict) and "error" in result:
        return []
    for tool in tools:
        if tool.name == name and tool.touched_ids is not None:
            return tool.touched_ids(args, result)
    return []
