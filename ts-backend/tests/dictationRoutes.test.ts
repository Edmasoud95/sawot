import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerDictationRoutes } from "../src/dictationRoutes.js";

test("dictation relays the actual audio bytes without invoking a conversation", async () => {
  const app = Fastify();
  app.register(multipart);
  const originalFetch = globalThis.fetch;
  const audio = Buffer.from([26, 69, 223, 163, 0, 255, 1]);
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "http://sidecar/v1/audio/transcriptions");
    const file = (init!.body as FormData).get("file") as File;
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), audio);
    assert.equal(file.type, "audio/webm");
    return new Response(JSON.stringify({ text: "The spoken draft" }));
  };
  registerDictationRoutes(app, "http://sidecar");
  try {
    const boundary = "sawot-dictation";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dictation.webm"\r\nContent-Type: audio/webm\r\n\r\n`), audio,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({method:"POST", url:"/api/chat/transcribe", headers:{"content-type":`multipart/form-data; boundary=${boundary}`}, payload});
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), {text:"The spoken draft"});
    const missing = await app.inject({method:"POST",url:"/api/chat/transcribe",payload:{}});
    assert.equal(missing.statusCode,400);
  } finally { globalThis.fetch = originalFetch; await app.close(); }
});
