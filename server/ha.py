import httpx

# Renders "entity_id|area" lines; area_name() returns None -> empty string.
_AREA_TEMPLATE = (
    "{% for s in states %}"
    "{{ s.entity_id }}|{{ area_name(s.entity_id) or '' }}\n"
    "{% endfor %}"
)


class HomeAssistant:
    """Async client for the Home Assistant REST API."""

    def __init__(
        self,
        base_url: str,
        token: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=10.0,
            transport=transport,
        )
        self._areas: dict[str, str] = {}

    async def load_areas(self) -> None:
        """Cache entity_id -> area name via the template API. Call once at startup."""
        resp = await self._client.post("/api/template", json={"template": _AREA_TEMPLATE})
        resp.raise_for_status()
        self._areas = {}
        for line in resp.text.strip().splitlines():
            entity_id, _, area = line.partition("|")
            if area:
                self._areas[entity_id.strip()] = area

    async def get_entities(
        self, domain: str | None = None, area: str | None = None
    ) -> list[dict]:
        resp = await self._client.get("/api/states")
        resp.raise_for_status()
        entities = []
        for s in resp.json():
            entity_id = s["entity_id"]
            if domain and not entity_id.startswith(domain + "."):
                continue
            entity_area = self._areas.get(entity_id)
            if area and (entity_area or "").lower() != area.lower():
                continue
            entities.append(
                {
                    "entity_id": entity_id,
                    "name": s["attributes"].get("friendly_name", entity_id),
                    "state": s["state"],
                    "area": entity_area,
                }
            )
        return entities

    async def call_service(
        self,
        domain: str,
        service: str,
        entity_id: str,
        data: dict | None = None,
    ) -> dict:
        payload = {"entity_id": entity_id, **(data or {})}
        resp = await self._client.post(f"/api/services/{domain}/{service}", json=payload)
        resp.raise_for_status()
        return {"ok": True}

    # Domains worth listing in the system prompt. A full registry can run to
    # thousands of sensor/diagnostic entities and overflow the LLM context;
    # anything outside this set stays reachable via the get_entities tool.
    SUMMARY_DOMAINS = frozenset(
        {
            "light", "switch", "climate", "cover", "fan", "media_player",
            "lock", "scene", "script", "vacuum", "humidifier",
            "alarm_control_panel",
        }
    )

    async def entity_summary(self) -> str:
        """Compact one-line-per-entity summary of controllable devices."""
        entities = await self.get_entities()
        return "\n".join(
            f"{e['entity_id']} | {e['name']} | {e['area'] or '?'} | {e['state']}"
            for e in entities
            if e["entity_id"].partition(".")[0] in self.SUMMARY_DOMAINS
        )

    CARD_ATTRS = (
        "brightness",
        "temperature",
        "current_temperature",
        "unit_of_measurement",
        "rgb_color",
        "color_temp_kelvin",
        "min_color_temp_kelvin",
        "max_color_temp_kelvin",
        "supported_color_modes",
    )

    async def get_cards(self, entity_ids: list[str]) -> list[dict]:
        """Rich state dicts for the given ids, in the given order."""
        wanted = set(entity_ids)
        resp = await self._client.get("/api/states")
        resp.raise_for_status()
        by_id = {}
        for s in resp.json():
            eid = s["entity_id"]
            if eid not in wanted:
                continue
            by_id[eid] = {
                "entity_id": eid,
                "domain": eid.partition(".")[0],
                "name": s["attributes"].get("friendly_name", eid),
                "area": self._areas.get(eid),
                "state": s["state"],
                "attrs": {
                    k: s["attributes"][k]
                    for k in self.CARD_ATTRS
                    if k in s["attributes"]
                },
            }
        return [by_id[e] for e in entity_ids if e in by_id]

    async def aclose(self) -> None:
        await self._client.aclose()
