// Voice cloning is served by the sidecar, which owns models/tts/voices/. The
// upload cannot simply be proxied: the multipart parser registered for chat
// attachments consumes the body first and the proxy forwards it empty. So the
// recording is read here and re-sent as a fresh multipart request.
import type { FastifyInstance } from "fastify";

async function relay(reply: any, resp: Response) {
  const text = await resp.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { detail: text || `sidecar answered ${resp.status}` }; }
  return reply.code(resp.status).send(body);
}

export function registerVoiceRoutes(app: FastifyInstance, sidecarUrl: string): void {
  app.get("/api/voices", async (_req: any, reply: any) => relay(reply, await fetch(sidecarUrl + "/api/voices")));

  app.post("/api/voices", async (req: any, reply: any) => {
    let name = "";
    let file: { buffer: Buffer; filename: string; mimetype: string } | null = null;
    if (typeof req.isMultipart === "function" && req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === "file") file = { buffer: await part.toBuffer(), filename: part.filename || "clip.webm", mimetype: part.mimetype || "audio/webm" };
        else if (part.fieldname === "name") name = String(part.value ?? "");
      }
    }
    if (!file || file.buffer.length === 0) return reply.code(400).send({ detail: "no recording was received" });
    const form = new FormData();
    form.append("name", name);
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.filename);
    try {
      return await relay(reply, await fetch(sidecarUrl + "/api/voices", { method: "POST", body: form }));
    } catch (e: any) {
      return reply.code(502).send({ detail: "speech engine offline: " + String(e?.message ?? e) });
    }
  });

  app.delete("/api/voices/:name", async (req: any, reply: any) => {
    try {
      return await relay(reply, await fetch(sidecarUrl + "/api/voices/" + encodeURIComponent(String(req.params.name)), { method: "DELETE" }));
    } catch (e: any) {
      return reply.code(502).send({ detail: "speech engine offline: " + String(e?.message ?? e) });
    }
  });
}
