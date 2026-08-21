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


def make_pdf_bytes(text="hello pdf world"):
    import io as _io

    from pypdf import PdfWriter
    from pypdf.generic import (
        DecodedStreamObject,
        DictionaryObject,
        NameObject,
    )

    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 12 Tf 10 100 Td ({text}) Tj ET".encode())
    page[NameObject("/Contents")] = writer._add_object(stream)
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({
            NameObject("/F1"): writer._add_object(font)
        })
    })
    buf = _io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_upload_pdf_extracts_text(tmp_path):
    pdf = make_pdf_bytes("hello pdf world")
    client, ctx = make_client(tmp_path)
    resp = client.post(
        "/api/chat/upload",
        files={"file": ("doc.pdf", io.BytesIO(pdf), "application/pdf")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "pdf"
    assert "hello pdf world" in body["text"]
    assert (ctx.upload_dir / f"{body['id']}.pdf").exists()
    assert (ctx.upload_dir / f"{body['id']}.pdftxt").exists()


def test_upload_invalid_pdf_400(tmp_path):
    client, _ = make_client(tmp_path)
    resp = client.post(
        "/api/chat/upload",
        files={"file": ("bad.pdf", io.BytesIO(b"not a pdf"), "application/pdf")},
    )
    assert resp.status_code == 400


def test_serve_uploaded_image(tmp_path):
    client, ctx = make_client(tmp_path)
    up = client.post(
        "/api/chat/upload",
        files={"file": ("p.png", io.BytesIO(b"\x89PNG fake"), "image/png")},
    ).json()
    resp = client.get(f"/api/chat/uploads/{up['id']}")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == b"\x89PNG fake"


def test_serve_upload_rejects_bad_ids(tmp_path):
    client, ctx = make_client(tmp_path)
    (tmp_path / "uploads").mkdir(exist_ok=True)
    assert client.get("/api/chat/uploads/missing0000ab").status_code == 404
    assert client.get("/api/chat/uploads/..%2Fsecret").status_code == 404


def test_serve_upload_never_serves_pdftxt_sidecar(tmp_path):
    client, ctx = make_client(tmp_path)
    ctx.upload_dir.mkdir(parents=True, exist_ok=True)
    (ctx.upload_dir / "aaaabbbbcccc.pdftxt").write_text("sidecar")
    assert client.get("/api/chat/uploads/aaaabbbbcccc").status_code == 404


def test_to_openai_messages_pdf_kind(tmp_path):
    from server.chat import to_openai_messages

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    (upload_dir / "aaaabbbbcccc.pdf").write_bytes(b"%PDF binary")
    (upload_dir / "aaaabbbbcccc.pdftxt").write_text("extracted pdf text")
    messages = [{
        "role": "user", "content": "summarize",
        "attachments": [{"id": "aaaabbbbcccc", "name": "doc.pdf", "kind": "pdf"}],
    }]
    out = to_openai_messages(messages, upload_dir)
    assert "extracted pdf text" in out[0]["content"]
    assert "%PDF binary" not in str(out)
