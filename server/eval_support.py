class DryRunHA:
    """Wraps a real HomeAssistant client: reads pass through, writes are
    recorded instead of executed — so evals never touch real devices."""

    def __init__(self, ha):
        self._ha = ha
        self.calls: list[tuple] = []

    async def get_entities(self, domain=None, area=None):
        return await self._ha.get_entities(domain, area)

    async def call_service(self, domain, service, entity_id, data=None):
        self.calls.append((domain, service, entity_id, data))
        return {"ok": True, "dry_run": True}
