import json

import httpx
import pytest

from server.ha import HomeAssistant

STATES = [
    {
        "entity_id": "light.kitchen",
        "state": "on",
        "attributes": {"friendly_name": "Kitchen Light"},
    },
    {
        "entity_id": "light.bedroom",
        "state": "off",
        "attributes": {"friendly_name": "Bedroom Light"},
    },
    {
        "entity_id": "switch.fan",
        "state": "off",
        "attributes": {"friendly_name": "Fan"},
    },
]

AREA_TEMPLATE_RESPONSE = "light.kitchen|Kitchen\nlight.bedroom|Bedroom\nswitch.fan|\n"


def make_ha(handler) -> HomeAssistant:
    return HomeAssistant(
        "http://ha.local:8123",
        "tok",
        transport=httpx.MockTransport(handler),
    )


def default_handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["Authorization"] == "Bearer tok"
    if request.url.path == "/api/states":
        return httpx.Response(200, json=STATES)
    if request.url.path == "/api/template":
        return httpx.Response(200, text=AREA_TEMPLATE_RESPONSE)
    if request.url.path.startswith("/api/services/"):
        return httpx.Response(200, json=[])
    return httpx.Response(404)


async def test_get_entities_all():
    ha = make_ha(default_handler)
    await ha.load_areas()
    entities = await ha.get_entities()
    assert len(entities) == 3
    assert entities[0] == {
        "entity_id": "light.kitchen",
        "name": "Kitchen Light",
        "state": "on",
        "area": "Kitchen",
    }


async def test_get_entities_filters_domain_and_area():
    ha = make_ha(default_handler)
    await ha.load_areas()
    lights = await ha.get_entities(domain="light")
    assert [e["entity_id"] for e in lights] == ["light.kitchen", "light.bedroom"]
    kitchen = await ha.get_entities(area="kitchen")  # case-insensitive
    assert [e["entity_id"] for e in kitchen] == ["light.kitchen"]


async def test_call_service_posts_payload():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/services/light/turn_on":
            captured.update(json.loads(request.content))
            return httpx.Response(200, json=[])
        return default_handler(request)

    ha = make_ha(handler)
    result = await ha.call_service(
        "light", "turn_on", "light.kitchen", {"brightness_pct": 50}
    )
    assert result == {"ok": True}
    assert captured == {"entity_id": "light.kitchen", "brightness_pct": 50}


async def test_entity_summary_is_compact_lines():
    ha = make_ha(default_handler)
    await ha.load_areas()
    summary = await ha.entity_summary()
    lines = summary.splitlines()
    assert len(lines) == 3
    assert lines[0] == "light.kitchen | Kitchen Light | Kitchen | on"
    assert lines[2] == "switch.fan | Fan | ? | off"


async def test_http_error_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    ha = make_ha(handler)
    with pytest.raises(httpx.HTTPStatusError):
        await ha.get_entities()
