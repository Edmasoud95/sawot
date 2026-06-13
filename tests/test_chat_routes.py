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


import json as _json
from types import SimpleNamespace


def parse_sse(raw: str):
    return [
        _json.loads(line[len("data: "):])
        for line in raw.splitlines()
        if line.startswith("data: ")
    ]


def make_stream_chunks(text):
    def chunk(content):
        return SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content=content, tool_calls=None))]
        )
    return [chunk(t) for t in text]


class FakeStream:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._chunks:
            raise StopAsyncIteration
        return self._chunks.pop(0)


class StreamingFakeLLM:
    """First call streams; subsequent non-streaming calls return a title."""

    def __init__(self, streamed_text="Hi there", title="Greeting"):
        self.streamed_text = streamed_text
        self.title = title
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return FakeStream(make_stream_chunks(list(self.streamed_text)))
        msg = SimpleNamespace(content=self.title, tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def test_message_stream_and_persistence(tmp_path):
    llm = StreamingFakeLLM()
    client, ctx = make_client(tmp_path, client=llm)
    conv = client.post("/api/chat/conversations", json={}).json()
    resp = client.post(
        f"/api/chat/conversations/{conv['id']}/messages",
        json={"content": "hello"},
    )
    events = parse_sse(resp.text)
    assert "".join(e["delta"] for e in events if e["type"] == "content") == "Hi there"
    done = [e for e in events if e["type"] == "done"][0]
    assert done["message"]["content"] == "Hi there"
    assert done["title"] == "Greeting"  # auto-titled on first exchange
    stored = ctx.store.get(conv["id"])
    assert [m["role"] for m in stored["messages"]] == ["user", "assistant"]
    assert stored["title"] == "Greeting"


def test_message_to_unknown_conversation_404(tmp_path):
    client, _ = make_client(tmp_path)
    assert client.post(
        "/api/chat/conversations/nope/messages", json={"content": "x"}
    ).status_code == 404


def test_title_kept_after_first_exchange(tmp_path):
    llm = StreamingFakeLLM(title="Should Not Apply")
    client, ctx = make_client(tmp_path, client=llm)
    conv = client.post("/api/chat/conversations", json={}).json()
    conv = ctx.store.get(conv["id"])
    conv["title"] = "Custom"
    ctx.store.save(conv)
    client.post(f"/api/chat/conversations/{conv['id']}/messages", json={"content": "x"})
    assert ctx.store.get(conv["id"])["title"] == "Custom"


def test_to_openai_messages_attachments(tmp_path):
    from server.chat import to_openai_messages

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "abcdef012345.txt").write_text("file body")
    (upload_dir / "1234567890ab.png").write_bytes(b"\x89PNG fake")
    messages = [
        {"role": "user", "content": "see attached",
         "attachments": [{"id": "abcdef012345", "name": "notes.txt", "kind": "text"},
                          {"id": "1234567890ab", "name": "p.png", "kind": "image"}]},
        {"role": "assistant", "content": "ok", "thinking": "secret"},
    ]
    out = to_openai_messages(messages, upload_dir)
    user = out[0]
    assert isinstance(user["content"], list)
    text_part = user["content"][0]["text"]
    assert "file body" in text_part and "notes.txt" in text_part
    image_part = user["content"][1]
    assert image_part["image_url"]["url"].startswith("data:image/png;base64,")
    # assistant thinking is never sent back to the model
    assert out[1] == {"role": "assistant", "content": "ok"}


def test_to_openai_messages_rejects_traversal_ids(tmp_path):
    from server.chat import to_openai_messages

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP SECRET")
    messages = [{
        "role": "user", "content": "hi",
        "attachments": [{"id": "../secret", "name": "x.txt", "kind": "text"}],
    }]
    out = to_openai_messages(messages, upload_dir)
    assert "TOP SECRET" not in str(out)
