import json

import httpx
from fastapi.testclient import TestClient

from server.main import create_app
from server.settings import KOKORO_VOICES, SettingsContext, SettingsStore


class FakeSTT:
    def transcribe(self, audio):
        return "hi"


class FakeAgent:
    def __init__(self, model="model-a"):
        self._model = model

    @property
    def model(self):
        return self._model

    def set_model(self, model):
        self._model = model

    def set_system_prompt(self, system_prompt):
        self.system_prompt = system_prompt

    async def run(self, history, user_text, on_event=None):
        return "ok"


class FakeTTS:
    def __init__(self, voice="af_heart"):
        self._voice = voice

    @property
    def voice(self):
        return self._voice

    def set_voice(self, voice):
        self._voice = voice

    def synthesize(self, text):
        return b"RIFF"


def lmstudio_handler(request: httpx.Request) -> httpx.Response:
    assert request.url.path.endswith("/models")
    return httpx.Response(
        200, json={"data": [{"id": "model-a"}, {"id": "model-b"}]}
    )


def make_client(tmp_path, handler=lmstudio_handler):
    agent, tts = FakeAgent(), FakeTTS()
    ctx = SettingsContext(
        store=SettingsStore(str(tmp_path / "settings.json")),
        agent=agent,
        tts=tts,
        lmstudio_url="http://lm.local:1234/v1",
        http=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )
    app = create_app(FakeSTT(), agent, tts, settings_ctx=ctx)
    return TestClient(app), agent, tts, ctx


def test_get_settings_lists_models_and_voices(tmp_path):
    client, *_ = make_client(tmp_path)
    data = client.get("/api/settings").json()
    assert data["model"] == "model-a"
    assert data["voice"] == "af_heart"
    assert data["models"] == ["model-a", "model-b"]
    assert data["voices"] == KOKORO_VOICES


def test_get_settings_survives_lmstudio_down(tmp_path):
    def down(request):
        raise httpx.ConnectError("refused")

    client, *_ = make_client(tmp_path, handler=down)
    data = client.get("/api/settings").json()
    assert data["models"] == []
    assert "models_error" in data


def test_post_settings_applies_and_persists(tmp_path):
    client, agent, tts, ctx = make_client(tmp_path)
    resp = client.post(
        "/api/settings", json={"model": "model-b", "voice": "am_adam"}
    )
    assert resp.status_code == 200
    assert agent.model == "model-b"
    assert tts.voice == "am_adam"
    saved = json.loads((tmp_path / "settings.json").read_text())
    assert saved == {"model": "model-b", "voice": "am_adam", "sassy": True}


def test_get_settings_reports_personality(tmp_path):
    client, *_ = make_client(tmp_path)
    assert client.get("/api/settings").json()["sassy"] is True


def test_post_personality_toggle_applies_and_persists(tmp_path):
    client, agent, _, ctx = make_client(tmp_path)
    ctx.summary = "Living room light"
    resp = client.post("/api/settings", json={"sassy": False})
    assert resp.status_code == 200
    assert resp.json()["sassy"] is False
    assert ctx.sassy is False
    # the agent's prompt was rebuilt without the sassy persona
    assert "friendly voice assistant" in agent.system_prompt
    assert "Next time do it yourself" not in agent.system_prompt
    saved = json.loads((tmp_path / "settings.json").read_text())
    assert saved["sassy"] is False


def test_post_unknown_model_rejected(tmp_path):
    client, agent, *_ = make_client(tmp_path)
    resp = client.post("/api/settings", json={"model": "nope"})
    assert resp.status_code == 400
    assert agent.model == "model-a"  # untouched


def test_post_unknown_voice_rejected(tmp_path):
    client, _, tts, _ = make_client(tmp_path)
    resp = client.post("/api/settings", json={"voice": "xx_nope"})
    assert resp.status_code == 400
    assert tts.voice == "af_heart"


def test_post_model_with_lmstudio_down_is_502(tmp_path):
    def down(request):
        raise httpx.ConnectError("refused")

    client, agent, *_ = make_client(tmp_path, handler=down)
    resp = client.post("/api/settings", json={"model": "model-b"})
    assert resp.status_code == 502
    assert agent.model == "model-a"


def test_store_roundtrip(tmp_path):
    store = SettingsStore(str(tmp_path / "s.json"))
    assert store.load() == {}
    store.save({"model": "m"})
    assert store.load() == {"model": "m"}


def test_store_load_survives_corrupt_file(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{truncated")
    assert SettingsStore(str(p)).load() == {}


def test_post_voice_only_with_lmstudio_down_reports_models_error(tmp_path):
    def down(request):
        raise httpx.ConnectError("refused")

    client, _, tts, _ = make_client(tmp_path, handler=down)
    resp = client.post("/api/settings", json={"voice": "am_adam"})
    assert resp.status_code == 200
    assert tts.voice == "am_adam"
    data = resp.json()
    assert "models_error" in data


def test_no_settings_routes_without_ctx():
    app = create_app(FakeSTT(), FakeAgent(), FakeTTS())
    client = TestClient(app)
    assert client.get("/api/settings").status_code in (404, 405)
