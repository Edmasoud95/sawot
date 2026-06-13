from fastapi.testclient import TestClient

from server.main import create_app


class FakeSTT:
    def __init__(self, text="turn on the light"):
        self.text = text

    def transcribe(self, audio: bytes) -> str:
        return self.text


class FakeAgent:
    def __init__(self, reply="Done, light is on."):
        self.reply = reply
        self.seen = []
        self.entry_history_lens = []

    async def run(self, history, user_text, on_event=None):
        self.entry_history_lens.append(len(history))
        self.seen.append(user_text)
        history.append({"role": "user", "content": user_text})
        history.append({"role": "assistant", "content": self.reply})
        return self.reply


class FakeTTS:
    def synthesize(self, text: str) -> bytes:
        return b"RIFF-fake-wav"


def make_client(stt=None, agent=None, tts=None):
    app = create_app(stt or FakeSTT(), agent or FakeAgent(), tts or FakeTTS())
    return TestClient(app)


def recv_json_until(ws, wanted_type):
    """Skip interleaved debug frames; return (matching message, skipped debug)."""
    skipped = []
    while True:
        msg = ws.receive_json()
        if msg["type"] == wanted_type:
            return msg, skipped
        assert msg["type"] == "debug"
        skipped.append(msg)


def recv_bytes_skipping_debug(ws):
    import json

    while True:
        message = ws.receive()
        if "bytes" in message:
            return message["bytes"]
        assert json.loads(message["text"])["type"] == "debug"


def run_turn(ws, audio=b"fake-audio"):
    """Drive one full happy-path turn, skipping debug frames."""
    ws.send_bytes(audio)
    recv_json_until(ws, "transcript")
    recv_json_until(ws, "assistant_text")
    return recv_bytes_skipping_debug(ws)


def test_full_interaction_event_sequence():
    client = make_client()
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        transcript, _ = recv_json_until(ws, "transcript")
        assert transcript == {"type": "transcript", "text": "turn on the light"}
        reply, _ = recv_json_until(ws, "assistant_text")
        assert reply == {"type": "assistant_text", "text": "Done, light is on."}
        assert recv_bytes_skipping_debug(ws) == b"RIFF-fake-wav"


def test_empty_transcript_short_circuits():
    agent = FakeAgent()
    client = make_client(stt=FakeSTT(text=""), agent=agent)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        error, _ = recv_json_until(ws, "error")
        assert error == {"type": "error", "message": "I didn't catch that"}
    assert agent.seen == []  # LLM never invoked


def test_agent_failure_sends_error():
    class ExplodingAgent(FakeAgent):
        async def run(self, history, user_text, on_event=None):
            raise ConnectionError("boom")

    client = make_client(agent=ExplodingAgent())
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        recv_json_until(ws, "transcript")
        error, _ = recv_json_until(ws, "error")
        assert error == {"type": "error", "message": "LLM backend offline"}


def test_history_persists_across_turns_in_one_session():
    agent = FakeAgent()
    client = make_client(agent=agent)
    with client.websocket_connect("/ws") as ws:
        for _ in range(2):
            assert run_turn(ws) == b"RIFF-fake-wav"
    assert len(agent.seen) == 2
    assert agent.entry_history_lens == [0, 2]


def test_agent_failure_rolls_back_history():
    class FlakyAgent(FakeAgent):
        def __init__(self):
            super().__init__()
            self.fail_next = True

        async def run(self, history, user_text, on_event=None):
            self.entry_history_lens.append(len(history))
            if self.fail_next:
                self.fail_next = False
                history.append({"role": "user", "content": user_text})
                raise ConnectionError("boom")
            self.seen.append(user_text)
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": self.reply})
            return self.reply

    agent = FlakyAgent()
    client = make_client(agent=agent)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        recv_json_until(ws, "transcript")
        error, _ = recv_json_until(ws, "error")
        assert error["type"] == "error"
        run_turn(ws)
    assert agent.entry_history_lens == [0, 0]  # failed turn left nothing behind


class FakeHA:
    def __init__(self):
        self.service_calls = []

    async def get_cards(self, entity_ids):
        return [
            {"entity_id": e, "domain": e.split(".")[0], "name": e,
             "area": None, "state": "on", "attrs": {}}
            for e in entity_ids
        ]

    async def call_service(self, domain, service, entity_id, data=None):
        self.service_calls.append((domain, service, entity_id, data))
        return {"ok": True}


class TouchingAgent(FakeAgent):
    async def run(self, history, user_text, on_event=None):
        if on_event:
            await on_event("touched", {"entity_ids": ["light.kitchen"]})
            await on_event("llm_round", {"round": 1, "latency_ms": 5, "tool_calls": None})
        return await super().run(history, user_text)


def test_entities_event_after_tool_using_turn():
    ha = FakeHA()
    app = create_app(FakeSTT(), TouchingAgent(), FakeTTS(), ha=ha)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        recv_json_until(ws, "transcript")
        recv_json_until(ws, "assistant_text")
        entities, _ = recv_json_until(ws, "entities")
        assert entities["entities"][0]["entity_id"] == "light.kitchen"
        assert recv_bytes_skipping_debug(ws) == b"RIFF-fake-wav"


def test_touched_event_not_forwarded_as_debug():
    ha = FakeHA()
    app = create_app(FakeSTT(), TouchingAgent(), FakeTTS(), ha=ha)
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        _, before = recv_json_until(ws, "transcript")
        reply, mid = recv_json_until(ws, "assistant_text")
        events = [d["event"] for d in before + mid]
        assert "llm_round" in events       # normal events do pass through
        assert "touched" not in events     # touched is intercepted


class DebuggingAgent(FakeAgent):
    """Emits one debug event through the callback, like the real Agent."""

    async def run(self, history, user_text, on_event=None):
        if on_event:
            await on_event("llm_round", {"round": 1, "latency_ms": 5, "tool_calls": None})
        return await super().run(history, user_text)


def test_debug_frames_interleave_with_protocol():
    client = make_client(agent=DebuggingAgent())
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        transcript, before = recv_json_until(ws, "transcript")
        assert transcript == {"type": "transcript", "text": "turn on the light"}
        assert [d["event"] for d in before] == ["stt"]
        assert before[0]["data"]["text"] == "turn on the light"
        assert before[0]["data"]["latency_ms"] >= 0
        reply, mid = recv_json_until(ws, "assistant_text")
        assert [d["event"] for d in mid] == ["llm_round"]
        tts_dbg = ws.receive_json()
        assert tts_dbg["type"] == "debug"
        assert tts_dbg["event"] == "tts"
        assert tts_dbg["data"]["bytes"] == len(b"RIFF-fake-wav")
        assert ws.receive_bytes() == b"RIFF-fake-wav"
