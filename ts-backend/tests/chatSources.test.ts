import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes } from "../src/chatRoutes.js";

test("chat sources survive completion and disk reload, without raw tool output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sawot-sources-"));
  const app = Fastify();
  let round = 0;
  const client = { chat: { completions: { create: async () => (async function* () {
    const name = ["web_search", "fetch_page", "web_search"][round++];
    yield { choices: [{ delta: name
      ? { tool_calls: [{ index: 0, id: `call-${round}`, function: { name, arguments: "{}" } }] }
      : { content: "A sourced answer" } }] };
  })() } } };
  let searches = 0;
  registerChatRoutes(app, {
    store: new ChatStore(dir), resolve: () => ({ client, model: "m" }),
    ha: null, haTools: [], uploadDir: dir, name: "Assistant",
    getEntitySummary: () => "", getChatInstructions: () => "", getDefaultModel: () => "m",
    searchTools: [
      { name: "web_search", description: "", parameters: {}, handler: async () => ++searches === 1 ? {
        results: [
          { url: "https://example.com/one", title: "First source", description: "private body ".repeat(100) },
          { url: "https://example.org/two", title: "Second source" },
          { url: "javascript:alert(1)", title: "Unsafe" },
          { url: "https://user:pass@example.net", title: "Credentials" },
        ],
      } : { error: "internal diagnostic detail" } },
      { name: "fetch_page", description: "", parameters: {}, handler: async () => ({
        url: "https://example.com/one", title: "First source", content: "private page body",
      }) },
    ],
  });
  try {
    const created = await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} });
    const id = created.json().id;
    await app.inject({ method: "PATCH", url: `/api/chat/conversations/${id}`, payload: { title: "Sources" } });
    const reply = await app.inject({ method: "POST", url: `/api/chat/conversations/${id}/messages`, payload: { content: "Find sources" } });
    const events = reply.body.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    const searchEvents = events.filter(event => event.type === "search");
    assert.equal(searchEvents.length, 6, "each web tool reports start and completion/error");
    const done = events.find(event => event.type === "done");
    assert.deepEqual(done.message.search, {
      tool: "web_search", phase: "error", sources: [
        { url: "https://example.com/one", title: "First source", read: true },
        { url: "https://example.org/two", title: "Second source", read: false },
      ],
    });
    assert.doesNotMatch(JSON.stringify(done.message.search), /private|diagnostic|javascript|user:pass/);
    const reopened = (await app.inject({ method: "GET", url: `/api/chat/conversations/${id}` })).json();
    assert.deepEqual(reopened.messages.at(-1).search, done.message.search);
    assert.deepEqual(new ChatStore(dir).get(id).messages.at(-1).search, done.message.search);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
