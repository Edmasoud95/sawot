import json
from types import SimpleNamespace

from server.llm import Agent, build_system_prompt


class FakeToolCall:
    def __init__(self, id, name, arguments):
        self.id = id
        self.type = "function"
        self.function = SimpleNamespace(name=name, arguments=arguments)

    def model_dump(self):
        return {
            "id": self.id,
            "type": "function",
            "function": {
                "name": self.function.name,
                "arguments": self.function.arguments,
            },
        }


def make_response(content=None, tool_calls=None):
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


class FakeLLM:
    """Returns queued responses; records the messages of each call."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create)
        )

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class FakeHA:
    def __init__(self):
        self.service_calls = []

    async def get_entities(self, domain=None, area=None):
        return [{"entity_id": "light.kitchen", "name": "Kitchen Light",
                 "state": "off", "area": "Kitchen"}]

    async def call_service(self, domain, service, entity_id, data=None):
        self.service_calls.append((domain, service, entity_id, data))
        return {"ok": True}


async def test_plain_answer_no_tools():
    llm = FakeLLM([make_response(content="Hello there!")])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    history = []
    reply = await agent.run(history, "hi")
    assert reply == "Hello there!"
    # history now holds the user turn and the assistant turn
    assert history[0] == {"role": "user", "content": "hi"}
    assert history[-1] == {"role": "assistant", "content": "Hello there!"}
    # system prompt was sent but not stored in history
    assert llm.calls[0]["messages"][0] == {"role": "system", "content": "sys"}


async def test_tool_call_round_trip():
    tc = FakeToolCall(
        "call_1", "call_service",
        json.dumps({"domain": "light", "service": "turn_on",
                    "entity_id": "light.kitchen"}),
    )
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="Kitchen light is on."),
    ])
    ha = FakeHA()
    agent = Agent(llm, "test-model", ha, system_prompt="sys")
    reply = await agent.run([], "turn on the kitchen light")
    assert reply == "Kitchen light is on."
    assert ha.service_calls == [("light", "turn_on", "light.kitchen", None)]
    # second LLM call saw the tool result
    tool_msg = llm.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool"
    assert json.loads(tool_msg["content"]) == {"ok": True}


async def test_tool_error_is_fed_back_to_model():
    class BrokenHA(FakeHA):
        async def call_service(self, *a, **k):
            raise RuntimeError("HA unreachable")

    tc = FakeToolCall(
        "call_1", "call_service",
        json.dumps({"domain": "light", "service": "turn_on",
                    "entity_id": "light.kitchen"}),
    )
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="Sorry, I can't reach Home Assistant."),
    ])
    agent = Agent(llm, "test-model", BrokenHA(), system_prompt="sys")
    reply = await agent.run([], "turn on the kitchen light")
    assert reply == "Sorry, I can't reach Home Assistant."
    tool_msg = llm.calls[1]["messages"][-1]
    assert "HA unreachable" in tool_msg["content"]


async def test_max_rounds_bails_out():
    llm = FakeLLM([make_response(tool_calls=[FakeToolCall("c%d" % i, "get_entities", "{}")])
                   for i in range(5)])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    reply = await agent.run([], "loop forever")
    assert reply == "Sorry, I couldn't complete that."
    assert len(llm.calls) == 5


def test_build_system_prompt_includes_summary():
    prompt = build_system_prompt("light.kitchen | Kitchen Light | Kitchen | off")
    assert "light.kitchen | Kitchen Light | Kitchen | off" in prompt
    assert "voice assistant" in prompt.lower()


async def test_malformed_tool_arguments_survive():
    tc = FakeToolCall("call_1", "call_service", "{not valid json")
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="Something went wrong with that."),
    ])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    history = []
    reply = await agent.run(history, "turn on the light")
    assert reply == "Something went wrong with that."
    tool_msg = llm.calls[1]["messages"][-1]
    assert tool_msg["role"] == "tool"
    assert "invalid tool arguments" in tool_msg["content"]


async def test_unknown_tool_returns_error_result():
    tc = FakeToolCall("call_1", "reboot_house", "{}")
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="I can't do that."),
    ])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    reply = await agent.run([], "reboot the house")
    assert reply == "I can't do that."
    assert "unknown tool" in llm.calls[1]["messages"][-1]["content"]


async def test_bailout_reply_is_stored_in_history():
    llm = FakeLLM([make_response(tool_calls=[FakeToolCall(f"c{i}", "get_entities", "{}")])
                   for i in range(5)])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    history = []
    reply = await agent.run(history, "loop forever")
    assert history[-1] == {"role": "assistant", "content": reply}


class RecordingEvents:
    def __init__(self):
        self.events = []

    async def __call__(self, event, data):
        self.events.append((event, data))


async def test_debug_events_plain_answer():
    llm = FakeLLM([make_response(content="Hello!")])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    rec = RecordingEvents()
    await agent.run([], "hi", on_event=rec)
    assert len(rec.events) == 1
    event, data = rec.events[0]
    assert event == "llm_round"
    assert data["round"] == 1
    assert data["tool_calls"] is None
    assert data["latency_ms"] >= 0


async def test_debug_events_tool_round_trip():
    tc = FakeToolCall(
        "call_1", "call_service",
        json.dumps({"domain": "light", "service": "turn_on",
                    "entity_id": "light.kitchen"}),
    )
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="Done."),
    ])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    rec = RecordingEvents()
    await agent.run([], "turn on the kitchen light", on_event=rec)
    names = [e for e, _ in rec.events]
    assert names == ["llm_round", "tool_call", "tool_result", "touched", "llm_round"]
    assert rec.events[0][1]["tool_calls"] == ["call_service"]
    assert rec.events[1][1] == {
        "name": "call_service",
        "args": {"domain": "light", "service": "turn_on",
                 "entity_id": "light.kitchen"},
    }
    result = rec.events[2][1]
    assert result["name"] == "call_service"
    assert json.loads(result["result"]) == {"ok": True}
    assert result["size_chars"] == len(json.dumps({"ok": True}))


async def test_debug_event_failure_does_not_break_turn():
    async def broken(event, data):
        raise RuntimeError("observer exploded")

    llm = FakeLLM([make_response(content="Still fine.")])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    reply = await agent.run([], "hi", on_event=broken)
    assert reply == "Still fine."


def test_truncate_long_results():
    from server.llm import _truncate
    assert _truncate("short") == "short"
    long = "x" * 700
    out = _truncate(long)
    assert len(out) == 601 and out.endswith("…")


async def test_touched_events_for_tools():
    tc1 = FakeToolCall("c1", "get_entities", json.dumps({"domain": "light"}))
    tc2 = FakeToolCall(
        "c2", "call_service",
        json.dumps({"domain": "light", "service": "turn_on",
                    "entity_id": "light.kitchen"}),
    )
    llm = FakeLLM([
        make_response(tool_calls=[tc1, tc2]),
        make_response(content="Done."),
    ])
    agent = Agent(llm, "test-model", FakeHA(), system_prompt="sys")
    rec = RecordingEvents()
    await agent.run([], "do things", on_event=rec)
    touched = [d for e, d in rec.events if e == "touched"]
    assert touched == [
        {"entity_ids": ["light.kitchen"]},  # from get_entities result (FakeHA)
        {"entity_ids": ["light.kitchen"]},  # from call_service target
    ]


async def test_no_touched_event_for_failed_tool():
    class BrokenHA(FakeHA):
        async def call_service(self, *a, **k):
            raise RuntimeError("HA down")

    tc = FakeToolCall(
        "c1", "call_service",
        json.dumps({"domain": "light", "service": "turn_on",
                    "entity_id": "light.kitchen"}),
    )
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="Sorry."),
    ])
    agent = Agent(llm, "test-model", BrokenHA(), system_prompt="sys")
    rec = RecordingEvents()
    await agent.run([], "x", on_event=rec)
    assert all(e != "touched" for e, _ in rec.events)


async def test_get_entities_tool_result_is_capped():
    class HugeHA(FakeHA):
        async def get_entities(self, domain=None, area=None):
            return [{"entity_id": f"sensor.s{i}", "name": f"S{i}",
                     "state": "1", "area": None} for i in range(200)]

    tc = FakeToolCall("call_1", "get_entities", json.dumps({"domain": "sensor"}))
    llm = FakeLLM([
        make_response(tool_calls=[tc]),
        make_response(content="There are many sensors."),
    ])
    agent = Agent(llm, "test-model", HugeHA(), system_prompt="sys")
    await agent.run([], "list all sensors")
    tool_msg = json.loads(llm.calls[1]["messages"][-1]["content"])
    assert len(tool_msg["entities"]) == 60
    assert "140 more omitted" in tool_msg["note"]
