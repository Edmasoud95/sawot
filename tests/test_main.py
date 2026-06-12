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

    async def run(self, history, user_text):
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


def test_full_interaction_event_sequence():
    client = make_client()
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        assert ws.receive_json() == {"type": "transcript", "text": "turn on the light"}
        assert ws.receive_json() == {
            "type": "assistant_text",
            "text": "Done, light is on.",
        }
        assert ws.receive_bytes() == b"RIFF-fake-wav"


def test_empty_transcript_short_circuits():
    agent = FakeAgent()
    client = make_client(stt=FakeSTT(text=""), agent=agent)
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        assert ws.receive_json() == {"type": "error", "message": "I didn't catch that"}
    assert agent.seen == []  # LLM never invoked


def test_agent_failure_sends_error():
    class ExplodingAgent(FakeAgent):
        async def run(self, history, user_text):
            raise ConnectionError("boom")

    client = make_client(agent=ExplodingAgent())
    with client.websocket_connect("/ws") as ws:
        ws.send_bytes(b"fake-audio")
        ws.receive_json()  # transcript
        assert ws.receive_json() == {"type": "error", "message": "LLM backend offline"}


def test_history_persists_across_turns_in_one_session():
    agent = FakeAgent()
    client = make_client(agent=agent)
    with client.websocket_connect("/ws") as ws:
        for _ in range(2):
            ws.send_bytes(b"fake-audio")
            ws.receive_json(); ws.receive_json(); ws.receive_bytes()
    assert len(agent.seen) == 2
