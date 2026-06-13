from server.eval_support import DryRunHA


class StubHA:
    async def get_entities(self, domain=None, area=None):
        return [{"entity_id": "light.a", "name": "A", "state": "on", "area": None}]

    async def call_service(self, domain, service, entity_id, data=None):
        raise AssertionError("real call_service must never run in dry-run")


async def test_dry_run_records_without_executing():
    dry = DryRunHA(StubHA())
    assert (await dry.get_entities(domain="light"))[0]["entity_id"] == "light.a"
    result = await dry.call_service("light", "turn_on", "light.a", {"x": 1})
    assert result == {"ok": True, "dry_run": True}
    assert dry.calls == [("light", "turn_on", "light.a", {"x": 1})]
