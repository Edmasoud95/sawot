import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { Agent } from "../src/agent.js";
import { runVoiceTurn } from "../src/pipeline.js";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes } from "../src/chatRoutes.js";

for (const failStt of [false, true]) {
  test(`voice records context even when recognition fails: ${failStt}`, async () => {
    const events: any[] = [];
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: "Hello" } }] }) } } };
    await runVoiceTurn({
      transcribe: async () => { if (failStt) throw new Error("offline"); return "hi"; },
      voices: async () => ({ engine: "kokoro", voices: ["af_heart"], default: "af_heart" }),
      synthesize: async () => Buffer.from("wav"),
    } as any, new Agent(client as any, "actual-model", [], "assistant"), Buffer.from("audio"), [],
    (type, data) => { events.push({ type, ...data }); }, "af_heart", undefined,
    { providerId: "local", providerName: "Local server" });
    assert.equal(events[0].event, "context");
    assert.equal(events[0].data.model, "actual-model");
    assert.equal(events[0].data.providerName, "Local server");
    assert.equal(events[0].data.voice, "af_heart");
    if (failStt) assert.equal(events.at(-1).type, "error");
    else {
      const speech = events.find(e => e.event === "speech");
      assert.equal(speech.data.engine, "kokoro");
      assert.equal(speech.data.voice, "af_heart");
      assert.ok(events.indexOf(speech) < events.findIndex(e => e.event === "reply"));
    }
  });
}

test("chat exports resolved model/provider without leaking client credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sawot-debug-"));
  const app = Fastify();
  const store = new ChatStore(dir);
  const client = { apiKey: "private-test-key", chat: { completions: { create: async function* () {
    yield { choices: [{ delta: { content: "Hello" } }] };
  } } } };
  registerChatRoutes(app, {
    store, resolve: () => ({ client, model: "actual", providerId: "local", providerName: "Local server" }),
    haTools: [], searchTools: [], ha: null, uploadDir: dir, name: "SAWOT",
    getEntitySummary: () => "", getChatInstructions: () => "", getDefaultModel: () => "removed::actual",
  });
  try {
    const conv = store.create("removed::actual");
    conv.title = "Existing chat";
    store.save(conv);
    const response = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Hi" } });
    const events = response.body.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
    assert.equal(events[0].event, "context");
    assert.deepEqual(events[0].data, { model: "actual", providerId: "local", providerName: "Local server" });
    assert.doesNotMatch(response.body, /private-test-key|apiKey/);
    assert.equal(events.at(-1).type, "done");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
