import type { FastifyInstance } from "fastify";

/** Multipart must be rebuilt after Fastify consumes the incoming recording. */
export function registerDictationRoutes(app: FastifyInstance, sidecarUrl: string): void {
  app.post("/api/chat/transcribe", async (req: any, reply: any) => {
    if (!req.isMultipart()) return reply.code(400).send({ detail: "No recording received" });
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) return reply.code(400).send({ detail: "No recording received" });
    const audio = await part.toBuffer();
    if (!audio.length) return reply.code(400).send({ detail: "Recording is empty" });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: part.mimetype }), "dictation.audio");
    form.append("model", "whisper-1");
    const controller = new AbortController();
    const cancel = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on("close", cancel);
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(sidecarUrl + "/v1/audio/transcriptions", {
        method: "POST", body: form, signal: controller.signal,
      });
      if (!response.ok) return reply.code(502).send({ detail: "Speech recognition is unavailable" });
      const result: any = await response.json();
      if (typeof result.text !== "string") return reply.code(502).send({ detail: "Speech recognition returned no text" });
      return { text: result.text };
    } catch {
      return reply.code(502).send({ detail: "Could not reach speech recognition" });
    } finally {
      clearTimeout(timeout);
      reply.raw.off("close", cancel);
    }
  });
}
