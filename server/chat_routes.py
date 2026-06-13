import json
import logging
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

logger = logging.getLogger("voice.chat")

MAX_UPLOAD = 10 * 1024 * 1024
TEXT_CAP = 50_000
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
TEXT_EXTS = {
    ".txt", ".md", ".csv", ".json", ".py", ".js", ".jsx", ".ts", ".tsx",
    ".yaml", ".yml", ".html", ".css", ".sh", ".toml", ".ini", ".log",
}


@dataclass
class ChatContext:
    store: object          # ChatStore
    client: object         # AsyncOpenAI (None in route-only tests)
    ha: object             # HomeAssistant
    system_prompt: str
    default_model: Callable[[], str]
    upload_dir: Path


def register_chat_routes(app, ctx: ChatContext) -> None:
    from fastapi import HTTPException, UploadFile
    from fastapi.responses import Response, StreamingResponse

    from server.chat import run_chat, to_openai_messages

    ctx.upload_dir.mkdir(parents=True, exist_ok=True)

    @app.get("/api/chat/conversations")
    async def list_conversations():
        return ctx.store.list()

    @app.post("/api/chat/conversations")
    async def create_conversation(body: dict | None = None):
        model = (body or {}).get("model") or ctx.default_model()
        return ctx.store.create(model=model)

    @app.get("/api/chat/conversations/{cid}")
    async def get_conversation(cid: str):
        conv = ctx.store.get(cid)
        if conv is None:
            raise HTTPException(404)
        return conv

    @app.patch("/api/chat/conversations/{cid}")
    async def patch_conversation(cid: str, body: dict):
        conv = ctx.store.get(cid)
        if conv is None:
            raise HTTPException(404)
        if "title" in body:
            conv["title"] = str(body["title"])[:80]
        if "model" in body:
            conv["model"] = str(body["model"])
        ctx.store.save(conv)
        return conv

    @app.delete("/api/chat/conversations/{cid}", status_code=204)
    async def delete_conversation(cid: str):
        ctx.store.delete(cid)
        return Response(status_code=204)

    @app.post("/api/chat/upload")
    async def upload(file: UploadFile):
        data = await file.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(400, "file too large (max 10 MB)")
        ext = Path(file.filename or "").suffix.lower()
        uid = uuid.uuid4().hex[:12]
        if ext in IMAGE_EXTS:
            (ctx.upload_dir / f"{uid}{ext}").write_bytes(data)
            return {"id": uid, "name": file.filename, "kind": "image"}
        if ext in TEXT_EXTS:
            text = data.decode("utf-8", errors="replace")[:TEXT_CAP]
            (ctx.upload_dir / f"{uid}{ext}").write_bytes(data)
            return {"id": uid, "name": file.filename, "kind": "text", "text": text}
        raise HTTPException(400, f"unsupported file type: {ext or 'unknown'}")

    def sse(obj: dict) -> str:
        return f"data: {json.dumps(obj)}\n\n"

    async def _maybe_title(conv) -> None:
        if conv["title"] != "New chat" or ctx.client is None:
            return
        try:
            resp = await ctx.client.chat.completions.create(
                model=conv["model"],
                messages=[
                    {"role": "user", "content":
                        "Title this conversation in at most 5 words. "
                        "Reply with the title only.\n\nFirst message: "
                        + str(conv["messages"][0].get("content", ""))[:500]},
                ],
            )
            title = (resp.choices[0].message.content or "").strip().strip('"')
            if title:
                conv["title"] = title[:80]
        except Exception:
            logger.debug("auto-title failed", exc_info=True)

    @app.post("/api/chat/conversations/{cid}/messages")
    async def post_message(cid: str, body: dict):
        conv = ctx.store.get(cid)
        if conv is None:
            raise HTTPException(404)
        conv["messages"].append({
            "role": "user",
            "content": body.get("content", ""),
            "attachments": body.get("attachments", []),
        })
        conv["updated"] = time.time()
        ctx.store.save(conv)

        async def stream():
            assistant = {"role": "assistant", "content": "", "thinking": "",
                         "cards": []}
            persisted = False

            def persist():
                nonlocal persisted
                if persisted:
                    return
                persisted = True
                conv["messages"].append(assistant)
                conv["updated"] = time.time()
                ctx.store.save(conv)

            try:
                history = to_openai_messages(conv["messages"], ctx.upload_dir)
                async for event, data in run_chat(
                    ctx.client, conv["model"], ctx.ha, ctx.system_prompt, history
                ):
                    if event == "thinking":
                        assistant["thinking"] += data
                        yield sse({"type": "thinking", "delta": data})
                    elif event == "content":
                        assistant["content"] += data
                        yield sse({"type": "content", "delta": data})
                    elif event == "tool":
                        yield sse({"type": "tool", **data})
                    elif event == "entities":
                        assistant["cards"] = data
                        yield sse({"type": "entities", "entities": data})
                    elif event == "final":
                        assistant["content"] = data["content"]
                        assistant["thinking"] = data["thinking"]
                await _maybe_title(conv)
                persist()
                yield sse({"type": "done", "message": assistant,
                           "title": conv["title"]})
            except Exception as exc:
                logger.exception("chat stream failed")
                persist()
                yield sse({"type": "error", "message": str(exc)})
            finally:
                persist()  # client disconnect mid-stream keeps partial content

        return StreamingResponse(stream(), media_type="text/event-stream")
