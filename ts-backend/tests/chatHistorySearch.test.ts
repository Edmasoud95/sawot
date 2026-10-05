import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes } from "../src/chatRoutes.js";

test("history search finds message text and returns bounded excerpts without hidden content", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat-search-"));
  const app = Fastify();
  try {
    const store = new ChatStore(root);
    const chat = store.create("m");
    chat.title = "Weekend plans";
    chat.messages = [{ role: "user", content: "We should visit Kraków this weekend." },
      { role: "assistant", content: "Enjoy the trip.", thinking: "private thought", memory: [{ content: "private memory" }] }];
    store.save(chat);
    const other = store.create("m"); other.title = "Dinner"; other.messages = [{ role: "user", content: "Soup ideas" }]; store.save(other);
    registerChatRoutes(app, { store, uploadDir: root, resolve: () => { throw Error("no model"); }, haTools: [], searchTools: [], ha: null,
      name: "Test", getEntitySummary: () => "", getChatInstructions: () => "", getDefaultModel: () => "m" });
    const results = (await app.inject({ method: "GET", url: "/api/chat/conversations?q=KRAK%C3%93W" })).json();
    assert.deepEqual(results.map((c: any) => c.id), [chat.id]);
    assert.match(results[0].excerpt, /Kraków/);
    assert.ok(results[0].excerpt.length <= 160);
    assert.equal(JSON.stringify(results).includes("private"), false);
    assert.deepEqual((await app.inject({ method: "GET", url: "/api/chat/conversations?q=private" })).json(), []);
    const ordinary = (await app.inject({ method: "GET", url: "/api/chat/conversations" })).json();
    assert.equal(ordinary.length, 2);
    assert.equal(ordinary[0].messages, undefined);
    assert.equal(ordinary[0].excerpt, undefined);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
