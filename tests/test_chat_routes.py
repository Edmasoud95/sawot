import io

from fastapi.testclient import TestClient

from server.chat import ChatStore
from server.chat_routes import ChatContext
from server.main import create_app


class FakeSTT:
    def transcribe(self, audio):
        return "hi"


class FakeAgent:
    model = "default-model"

    async def run(self, history, user_text, on_event=None):
        return "ok"


class FakeTTS:
    def synthesize(self, text):
        return b"RIFF"


def make_client(tmp_path, **overrides):
    kwargs = dict(
        store=ChatStore(root=str(tmp_path / "convs")),
        client=None,
        ha=None,
        system_prompt="sys",
        default_model=lambda: "default-model",
        upload_dir=tmp_path / "uploads",
    )
    kwargs.update(overrides)
    ctx = ChatContext(**kwargs)
    app = create_app(FakeSTT(), FakeAgent(), FakeTTS(), chat_ctx=ctx)
    return TestClient(app), ctx


def test_conversation_crud(tmp_path):
    client, ctx = make_client(tmp_path)
    created = client.post("/api/chat/conversations", json={}).json()
    assert created["title"] == "New chat"
    assert created["model"] == "default-model"
    listed = client.get("/api/chat/conversations").json()
    assert [c["id"] for c in listed] == [created["id"]]
    patched = client.patch(
        f"/api/chat/conversations/{created['id']}",
        json={"title": "Lights", "model": "other"},
    ).json()
    assert patched["title"] == "Lights" and patched["model"] == "other"
    assert client.get(f"/api/chat/conversations/{created['id']}").json()["title"] == "Lights"
    assert client.delete(f"/api/chat/conversations/{created['id']}").status_code == 204
    assert client.get(f"/api/chat/conversations/{created['id']}").status_code == 404


def test_create_with_explicit_model(tmp_path):
    client, _ = make_client(tmp_path)
    conv = client.post("/api/chat/conversations", json={"model": "x"}).json()
    assert conv["model"] == "x"


def test_upload_image(tmp_path):
    client, ctx = make_client(tmp_path)
    resp = client.post(
        "/api/chat/upload",
        files={"file": ("photo.png", io.BytesIO(b"\x89PNG fake"), "image/png")},
    )
    body = resp.json()
    assert resp.status_code == 200
    assert body["kind"] == "image" and body["name"] == "photo.png"
    assert (ctx.upload_dir / f"{body['id']}.png").exists()


def test_upload_text_returns_content(tmp_path):
    client, _ = make_client(tmp_path)
    resp = client.post(
        "/api/chat/upload",
        files={"file": ("notes.md", io.BytesIO(b"# hello"), "text/markdown")},
    )
    body = resp.json()
    assert body["kind"] == "text" and body["text"] == "# hello"


def test_upload_rejects_unknown_type(tmp_path):
    client, _ = make_client(tmp_path)
    resp = client.post(
        "/api/chat/upload",
        files={"file": ("x.exe", io.BytesIO(b"MZ"), "application/octet-stream")},
    )
    assert resp.status_code == 400


def test_upload_rejects_oversize(tmp_path):
    client, _ = make_client(tmp_path)
    big = io.BytesIO(b"a" * (10 * 1024 * 1024 + 1))
    resp = client.post(
        "/api/chat/upload", files={"file": ("big.txt", big, "text/plain")}
    )
    assert resp.status_code == 400


def test_no_chat_routes_without_ctx(tmp_path):
    app = create_app(FakeSTT(), FakeAgent(), FakeTTS())
    assert TestClient(app).get("/api/chat/conversations").status_code in (404, 405)
