import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerVoiceRoutes } from "../src/voiceRoutes.js";

function fakeSidecar() {
  const seen: any[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, type: req.headers["content-type"], body });
      res.setHeader("content-type", "application/json");
      if (req.method === "POST") {
        const text = body.toString("latin1");
        if (!text.includes('name="file"')) { res.statusCode = 422; return res.end(JSON.stringify({ detail: "file missing" })); }
        const name = /name="name"\r\n\r\n([^\r]*)/.exec(text)?.[1];
        if (name === "bad") { res.statusCode = 400; return res.end(JSON.stringify({ detail: "bad name" })); }
        return res.end(JSON.stringify({ voice: name, engine: "chatterbox-turbo", voices: ["default", name], default: "default" }));
      }
      if (req.method === "DELETE") return res.end(JSON.stringify({ engine: "chatterbox-turbo", voices: ["default"], default: "default" }));
      res.end(JSON.stringify({ engine: "chatterbox-turbo", voices: ["default", "Ed"], default: "default" }));
    });
  });
  return new Promise<{ url: string; seen: any[]; close: () => void }>((r) => server.listen(0, () => r({ url: `http://127.0.0.1:${(server.address() as any).port}`, seen, close: () => server.close() })));
}

async function harness(url: string) {
  const app = Fastify();
  app.register(multipart);
  registerVoiceRoutes(app, url);
  await app.ready();
  return app;
}

function multipartBody(name: string, file: Buffer) {
  const b = "----sawot";
  const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="clip.webm"\r\nContent-Type: audio/webm\r\n\r\n`);
  return { body: Buffer.concat([head, file, Buffer.from(`\r\n--${b}--\r\n`)]), type: `multipart/form-data; boundary=${b}` };
}

test("a recording is forwarded to the sidecar with its name and bytes intact", async () => {
  const s = await fakeSidecar();
  const app = await harness(s.url);
  try {
    const file = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3, 255, 254]);
    const { body, type } = multipartBody("Ed", file);
    const res = await app.inject({ method: "POST", url: "/api/voices", payload: body, headers: { "content-type": type } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().voice, "Ed");
    const fwd = s.seen[0];
    assert.equal(fwd.url, "/api/voices");
    assert.match(fwd.type, /^multipart\/form-data/);
    assert.ok(fwd.body.includes(file), "the audio bytes reach the sidecar unchanged");
  } finally { await app.close(); s.close(); }
});

test("sidecar errors and missing uploads are reported with their detail", async () => {
  const s = await fakeSidecar();
  const app = await harness(s.url);
  try {
    const { body, type } = multipartBody("bad", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/api/voices", payload: body, headers: { "content-type": type } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().detail, "bad name");
    const none = await app.inject({ method: "POST", url: "/api/voices", payload: { name: "Ed" } });
    assert.equal(none.statusCode, 400);
    assert.match(none.json().detail, /recording/);
  } finally { await app.close(); s.close(); }
});

test("listing and deleting pass straight through", async () => {
  const s = await fakeSidecar();
  const app = await harness(s.url);
  try {
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/voices" })).json().voices, ["default", "Ed"]);
    const del = await app.inject({ method: "DELETE", url: "/api/voices/Ed's%20voice" });
    assert.equal(del.statusCode, 200);
    assert.equal(s.seen.at(-1).url, "/api/voices/Ed's%20voice");
  } finally { await app.close(); s.close(); }
});
