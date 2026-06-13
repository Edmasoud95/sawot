import json
from types import SimpleNamespace

from server.chat import run_chat


def chunk(content=None, reasoning=None, tool_calls=None):
    delta = SimpleNamespace(
        content=content, tool_calls=tool_calls
    )
    if reasoning is not None:
        delta.reasoning_content = reasoning
    return SimpleNamespace(choices=[SimpleNamespace(delta=delta)])


def tc_delta(index, id=None, name=None, arguments=None):
    fn = SimpleNamespace(name=name, arguments=arguments)
    return SimpleNamespace(index=index, id=id, function=fn)


class FakeStream:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)


class FakeLLM:
    def __init__(self, streams):
        self._streams = list(streams)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return FakeStream(self._streams.pop(0))


class FakeHA:
    def __init__(self):
        self.service_calls = []

    async def get_entities(self, domain=None, area=None):
        return [{"entity_id": "light.kitchen", "name": "Kitchen Light",
                 "state": "off", "area": "Kitchen"}]

    async def call_service(self, domain, service, entity_id, data=None):
        self.service_calls.append((domain, service, entity_id, data))
        return {"ok": True}

    async def get_cards(self, entity_ids):
        return [{"entity_id": e, "domain": e.split(".")[0], "name": e,
                 "area": None, "state": "on", "attrs": {}} for e in entity_ids]


async def collect(gen):
    return [e async for e in gen]


async def test_plain_content_stream():
    llm = FakeLLM([[chunk(content="Hel"), chunk(content="lo")]])
    events = await collect(run_chat(llm, "m", FakeHA(), "sys",
                                    [{"role": "user", "content": "hi"}]))
    assert ("content", "Hel") in events and ("content", "lo") in events
    final = [d for e, d in events if e == "final"][0]
    assert final["content"] == "Hello"
    assert final["thinking"] == ""
    # system prompt was prepended
    assert llm.calls[0]["messages"][0] == {"role": "system", "content": "sys"}
    assert llm.calls[0]["stream"] is True


async def test_reasoning_content_stream():
    llm = FakeLLM([[chunk(reasoning="mull "), chunk(reasoning="it"),
                    chunk(content="Answer")]])
    events = await collect(run_chat(llm, "m", FakeHA(), "sys",
                                    [{"role": "user", "content": "hi"}]))
    assert ("thinking", "mull ") in events
    final = [d for e, d in events if e == "final"][0]
    assert final["thinking"] == "mull it"
    assert final["content"] == "Answer"


async def test_inline_think_tags_stream():
    llm = FakeLLM([[chunk(content="<thi"), chunk(content="nk>hmm</think>Yes")]])
    events = await collect(run_chat(llm, "m", FakeHA(), "sys",
                                    [{"role": "user", "content": "hi"}]))
    final = [d for e, d in events if e == "final"][0]
    assert final["thinking"] == "hmm"
    assert final["content"] == "Yes"


async def test_tool_round_with_split_deltas_and_entities():
    args = json.dumps({"domain": "light", "service": "turn_on",
                       "entity_id": "light.kitchen"})
    round1 = [
        chunk(tool_calls=[tc_delta(0, id="c1", name="call_service",
                                   arguments=args[:10])]),
        chunk(tool_calls=[tc_delta(0, arguments=args[10:])]),
    ]
    round2 = [chunk(content="Done.")]
    ha = FakeHA()
    llm = FakeLLM([round1, round2])
    events = await collect(run_chat(llm, "m", ha, "sys",
                                    [{"role": "user", "content": "lights on"}]))
    assert ha.service_calls == [("light", "turn_on", "light.kitchen", None)]
    tool = [d for e, d in events if e == "tool"][0]
    assert tool["name"] == "call_service"
    assert json.loads(llm.calls[1]["messages"][-1]["content"]) == {"ok": True}
    ents = [d for e, d in events if e == "entities"][0]
    assert ents[0]["entity_id"] == "light.kitchen"
    final = [d for e, d in events if e == "final"][0]
    assert final["content"] == "Done."


async def test_tool_error_no_entities():
    class BrokenHA(FakeHA):
        async def call_service(self, *a, **k):
            raise RuntimeError("down")

    args = json.dumps({"domain": "light", "service": "turn_on",
                       "entity_id": "light.kitchen"})
    llm = FakeLLM([
        [chunk(tool_calls=[tc_delta(0, id="c1", name="call_service",
                                    arguments=args)])],
        [chunk(content="Sorry.")],
    ])
    events = await collect(run_chat(llm, "m", BrokenHA(), "sys",
                                    [{"role": "user", "content": "x"}]))
    assert not [d for e, d in events if e == "entities"]
    assert "down" in [d for e, d in events if e == "tool"][0]["result"]


async def test_round_cap():
    args = "{}"
    rounds = [[chunk(tool_calls=[tc_delta(0, id=f"c{i}", name="get_entities",
                                          arguments=args)])] for i in range(5)]
    llm = FakeLLM(rounds)
    events = await collect(run_chat(llm, "m", FakeHA(), "sys",
                                    [{"role": "user", "content": "loop"}]))
    final = [d for e, d in events if e == "final"][0]
    assert final["content"] == "Sorry, I couldn't complete that."
    assert len(llm.calls) == 5


async def test_content_before_tool_round_is_kept():
    args = json.dumps({"domain": "light", "service": "turn_on",
                       "entity_id": "light.kitchen"})
    round1 = [
        chunk(content="Let me do that. "),
        chunk(tool_calls=[tc_delta(0, id="c1", name="call_service",
                                   arguments=args)]),
    ]
    round2 = [chunk(content="Done.")]
    llm = FakeLLM([round1, round2])
    events = await collect(run_chat(llm, "m", FakeHA(), "sys",
                                    [{"role": "user", "content": "x"}]))
    final = [d for e, d in events if e == "final"][0]
    assert final["content"] == "Let me do that. Done."
