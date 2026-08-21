"""Home Assistant tools for the agent tool registry."""

from server.tools import Tool

MAX_TOOL_ENTITIES = 60


def _get_entities_handler(ha):
    async def handler(args: dict) -> dict:
        entities = await ha.get_entities(args.get("domain"), args.get("area"))
        if len(entities) > MAX_TOOL_ENTITIES:
            return {
                "entities": entities[:MAX_TOOL_ENTITIES],
                "note": (
                    f"{len(entities) - MAX_TOOL_ENTITIES} more omitted — "
                    "narrow the query with domain and/or area"
                ),
            }
        return entities

    return handler


def _call_service_handler(ha):
    async def handler(args: dict) -> dict:
        return await ha.call_service(
            args["domain"], args["service"], args["entity_id"], args.get("data")
        )

    return handler


def _get_entities_touched(args: dict, result) -> list[str]:
    items = result.get("entities") if isinstance(result, dict) else result
    if isinstance(items, list):
        return [
            e["entity_id"]
            for e in items
            if isinstance(e, dict) and "entity_id" in e
        ]
    return []


def _call_service_touched(args: dict, result) -> list[str]:
    eid = args.get("entity_id")
    return [eid] if eid else []


def build_ha_tools(ha) -> list[Tool]:
    """The standard Home Assistant toolset: list entities + call services."""
    return [
        Tool(
            name="get_entities",
            description=(
                "List Home Assistant entities with their current state. "
                "Filter by domain (e.g. 'light', 'switch', 'climate') "
                "and/or area name (e.g. 'Kitchen')."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "Entity domain filter"},
                    "area": {"type": "string", "description": "Area name filter"},
                },
            },
            handler=_get_entities_handler(ha),
            touched_ids=_get_entities_touched,
        ),
        Tool(
            name="call_service",
            description=(
                "Call a Home Assistant service to control a device, e.g. "
                "domain='light', service='turn_on', entity_id='light.kitchen', "
                "data={'brightness_pct': 50}."
            ),
            parameters={
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
            handler=_call_service_handler(ha),
            touched_ids=_call_service_touched,
        ),
    ]
