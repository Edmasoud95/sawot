import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes, type ChatCtx } from "../src/chatRoutes.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "sawot-chat-")); }

test("conversations carry a Home Assistant flag that defaults to off", () => {
  const root = tmp();
  const store = new ChatStore(root);
  const off = store.create("local::m");
  assert.equal(off.homeAssistant, false);
  const on = store.create("local::m", true);
  assert.equal(on.homeAssistant, true);
  // A file written before the flag existed reads as off.
  writeFileSync(join(root, "abcdefabcdef.json"), JSON.stringify({ id: "abcdefabcdef", title: "Old", model: "m", created: 1, updated: 1, messages: [] }));
  const listing = store.list();
  assert.deepEqual(listing.map((c) => [c.id, c.homeAssistant]).sort(), [[off.id, false], [on.id, true], ["abcdefabcdef", false]].sort());
});

function harness(opts: Partial<ChatCtx> = {}) {
  const dir = tmp();
  const ctx: ChatCtx = {
    store: new ChatStore(join(dir, "conversations")),
    resolve: () => { throw new Error("no model in this test"); },
    haTools: [],
    searchTools: [],
    ha: null,
    uploadDir: join(dir, "uploads"),
    name: "Rita",
    getEntitySummary: () => "(devices)",
    getChatInstructions: () => "",
    getDefaultModel: () => "local::m",
    ...opts,
  };
  const app = Fastify();
  registerChatRoutes(app, ctx);
  return { app, ctx };
}

test("the flag is set on create and toggled by patch", async () => {
  const { app } = harness();
  try {
    let res = await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { homeAssistant: true } });
    const id = res.json().id;
    assert.equal(res.json().homeAssistant, true);
    res = await app.inject({ method: "PATCH", url: `/api/chat/conversations/${id}`, payload: { homeAssistant: false } });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "GET", url: `/api/chat/conversations/${id}` });
    assert.equal(res.json().homeAssistant, false, "the change is persisted");
    res = await app.inject({ method: "GET", url: "/api/chat/conversations" });
    assert.equal(res.json().find((c: any) => c.id === id).homeAssistant, false);
  } finally { await app.close(); }
});
