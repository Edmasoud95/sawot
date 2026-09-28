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
  for (const conv of [off, on]) { conv.messages.push({ role: "user", content: "Hi" }); store.save(conv); }
  // A file written before the flag existed reads as off.
  writeFileSync(join(root, "abcdefabcdef.json"), JSON.stringify({ id: "abcdefabcdef", title: "Old", model: "m", created: 1, updated: 1, messages: [{ role: "user", content: "Hi" }] }));
  const listing = store.list();
  assert.deepEqual(listing.map((c) => [c.id, c.homeAssistant]).sort(), [[off.id, false], [on.id, true], ["abcdefabcdef", false]].sort());
});

function harness(opts: Partial<ChatCtx> = {}) {
  const dir = tmp();
  const ctx: ChatCtx = {
    store: new ChatStore(join(dir, "conversations")),
    resolve: () => { throw new Error("no model in this test"); },
    haTools: [],
    isHomeAssistantConfigured: () => true,
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
    res = await app.inject({ method: "PATCH", url: `/api/chat/conversations/${id}`, payload: { homeAssistant: false, draftText: "Test my setting" } });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "GET", url: `/api/chat/conversations/${id}` });
    assert.equal(res.json().homeAssistant, false, "the change is persisted");
    res = await app.inject({ method: "GET", url: "/api/chat/conversations" });
    assert.equal(res.json().find((c: any) => c.id === id).homeAssistant, false);
  } finally { await app.close(); }
});

async function* once(text: string) { yield { choices: [{ delta: { content: text } }] }; }

function recordingClient(requests: any[]) {
  return { chat: { completions: { create: async (body: any) => { requests.push(body); return once("done"); } } } };
}

function sseEvents(body: string): any[] {
  return body.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

test("chat sends older exchanges beyond the former 30-message cutoff", async () => {
  const requests: any[] = [];
  const { app, ctx } = harness({ resolve: () => ({ client: recordingClient(requests), model: "m" }) });
  try {
    const conv = ctx.store.create("m");
    conv.title = "Existing chat";
    conv.messages = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `message ${i}` }));
    ctx.store.save(conv);
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Continue" } });
    assert.ok(sseEvents(res.body).some(e => e.type === "done"));
    assert.equal(requests[0].messages.length, 42);
    assert.equal(requests[0].messages[1].content, "message 0");
    assert.equal(ctx.store.get(conv.id).messages.length, 42);
  } finally { await app.close(); }
});

test("chat explains provider context overflow without deleting saved messages", async () => {
  const client = { chat: { completions: { create: async () => {
    throw Object.assign(new Error("provider rejected input"), { status: 400, code: "context_length_exceeded" });
  } } } };
  const { app, ctx } = harness({ resolve: () => ({ client, model: "m" }) });
  try {
    const conv = ctx.store.create("m");
    conv.messages.push({ role: "user", content: "Keep this" }, { role: "assistant", content: "Remembered" });
    ctx.store.save(conv);
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Continue" } });
    const error = sseEvents(res.body).find(e => e.type === "error");
    assert.match(error.message, /conversation.*too long/i);
    assert.match(error.message, /new conversation/i);
    assert.equal(ctx.store.get(conv.id).messages[0].content, "Keep this");
  } finally { await app.close(); }
});

const haTool = { name: "get_entities", description: "", parameters: {}, handler: async () => [] };
const searchTool = { name: "web_search", description: "", parameters: {}, handler: async () => ({ results: [] }) };

test("a general conversation gets the chat prompt and only the search tools", async () => {
  const requests: any[] = [];
  const { app } = harness({
    resolve: () => ({ client: recordingClient(requests), model: "m" }),
    haTools: [haTool], searchTools: [searchTool],
    getChatInstructions: () => "Call me Ed.",
  });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "hello" } });
    assert.equal(res.statusCode, 200);
    const system = requests[0].messages[0];
    assert.equal(system.role, "system");
    assert.match(system.content, /general-purpose AI assistant/);
    assert.match(system.content, /Call me Ed\./);
    assert.match(system.content, /web_search/);
    assert.doesNotMatch(system.content, /Devices:/);
    assert.deepEqual(requests[0].tools.map((t: any) => t.function.name), ["web_search"]);
    const done = sseEvents(res.body).find((e) => e.type === "done");
    assert.equal(done.message.content, "done");
  } finally { await app.close(); }
});

test("a Home Assistant conversation adds the device block and tools", async () => {
  const requests: any[] = [];
  const { app } = harness({
    resolve: () => ({ client: recordingClient(requests), model: "m" }),
    haTools: [haTool], searchTools: [searchTool],
  });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { homeAssistant: true } })).json();
    await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "lights?" } });
    assert.match(requests[0].messages[0].content, /Devices:\n\(devices\)/);
    assert.deepEqual(requests[0].tools.map((t: any) => t.function.name), ["web_search", "get_entities"]);
  } finally { await app.close(); }
});

test("without a search key and without Home Assistant no tools are sent", async () => {
  const requests: any[] = [];
  const { app } = harness({ resolve: () => ({ client: recordingClient(requests), model: "m" }), haTools: [haTool] });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "hi" } });
    assert.equal("tools" in requests[0], false);
    assert.doesNotMatch(requests[0].messages[0].content, /web_search/);
  } finally { await app.close(); }
});

test("text chat executes find_in_page and gives matching passages to the model", async () => {
  const { buildSearchTools } = await import("../src/search.js");
  const requests: any[] = [];
  const searchTools = buildSearchTools({ search: async () => [] }, {
    lookup: async () => ["93.184.216.34"],
    fetchFn: async () => new Response("Intro ".repeat(5000) + "The warranty lasts two years.", { headers: { "content-type": "text/plain" } }),
  });
  async function* call() {
    yield { choices: [{ delta: { tool_calls: [{ index: 0, id: "find-1", function: {
      name: "find_in_page", arguments: '{"url":"https://example.com/manual","query":"warranty"}',
    } }] } }] };
  }
  const client = { chat: { completions: { create: async (body: any) => {
    requests.push(structuredClone(body));
    return requests.length === 1 ? call() : once("The warranty lasts two years.");
  } } } };
  const { app } = harness({ searchTools, resolve: () => ({ client, model: "m" }) });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Find the warranty in the manual" } });
    assert.equal(res.statusCode, 200);
    assert.ok(requests[0].tools.some((t: any) => t.function.name === "find_in_page"));
    assert.match(requests[0].messages[0].content, /find_in_page/);
    const found = JSON.parse(requests[1].messages.find((m: any) => m.role === "tool").content);
    assert.match(found.matches[0].text, /warranty lasts two years/);
    assert.ok(sseEvents(res.body).some(e => e.type === "tool" && e.name === "find_in_page"));
    assert.equal(sseEvents(res.body).find(e => e.type === "done").message.content, "The warranty lasts two years.");
  } finally { await app.close(); }
});

test("web search defaults on for existing chats and persists per conversation", async () => {
  const { app, ctx } = harness();
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    assert.equal(conv.webSearch, true);
    const legacy = { ...conv };
    delete legacy.webSearch;
    ctx.store.save(legacy);
    assert.equal(ctx.store.get(conv.id).webSearch, true);
    const patched = await app.inject({ method: "PATCH", url: `/api/chat/conversations/${conv.id}`, payload: { webSearch: false, draftText: "Test web search" } });
    assert.equal(patched.json().webSearch, false);
    assert.equal(ctx.store.get(conv.id).webSearch, false);
    assert.equal(ctx.store.list().find(c => c.id === conv.id).webSearch, false);
    const other = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { webSearch: false } })).json();
    assert.equal(other.webSearch, false);
    await app.inject({ method: "PATCH", url: `/api/chat/conversations/${conv.id}`, payload: { webSearch: true } });
    assert.equal(ctx.store.get(conv.id).webSearch, true);
    assert.equal(ctx.store.get(other.id).webSearch, false);
  } finally { await app.close(); }
});

test("disabling web search removes search tools and instructions while retaining Home Assistant", async () => {
  const requests: any[] = [];
  const { app } = harness({
    resolve: () => ({ client: recordingClient(requests), model: "m" }),
    haTools: [haTool], searchTools: [searchTool],
  });
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: { homeAssistant: true, webSearch: false } })).json();
    await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "hello" } });
    assert.deepEqual(requests[0].tools.map((t: any) => t.function.name), ["get_entities"]);
    assert.doesNotMatch(requests[0].messages[0].content, /You have web tools/);
  } finally { await app.close(); }
});

test("history excludes empty chats and short drafts, restores qualifying drafts, and promotes sent messages", async () => {
  const { app, ctx } = harness();
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const url = `/api/chat/conversations/${conv.id}`;
    const history = async () => (await app.inject({ method: "GET", url: "/api/chat/conversations" })).json();
    assert.deepEqual(await history(), [], "opening a chat must not add history");
    for (const draftText of ["", "hello", "hello there", "   \n  "]) {
      await app.inject({ method: "PATCH", url, payload: { draftText } });
      assert.deepEqual(await history(), []);
    }
    await app.inject({ method: "PATCH", url, payload: { draftText: "Plan my weekend" } });
    assert.equal((await history())[0].title, "Draft: Plan my weekend");
    assert.equal((await history())[0].isDraft, true);
    assert.equal(ctx.store.get(conv.id).draftText, "Plan my weekend");
    await app.inject({ method: "PATCH", url, payload: { draftText: "Plan my" } });
    assert.deepEqual(await history(), [], "shortening the draft hides it again");
    await app.inject({ method: "PATCH", url, payload: { draftText: "Plan my weekend" } });
    await app.inject({ method: "POST", url: `${url}/messages`, payload: { content: "Hi" } });
    assert.equal((await history()).length, 1, "a single sent word counts even if the model fails");
    assert.equal((await history())[0].isDraft, false);
    assert.equal(ctx.store.get(conv.id).draftText, "");
  } finally { await app.close(); }
});

test("finishing a response preserves a draft typed while the model was replying", async () => {
  let release: () => void;
  let started: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { started = resolve; });
  const client = { chat: { completions: { create: async () => (async function* () {
    started!();
    await waiting;
    yield { choices: [{ delta: { content: "Answer" } }] };
  })() } } };
  const { app, ctx } = harness({ resolve: () => ({ client, model: "m" }) });
  try {
    const conv = ctx.store.create("m");
    const sending = app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Hi" } }).then(res => res);
    await ready;
    await app.inject({ method: "PATCH", url: `/api/chat/conversations/${conv.id}`, payload: { draftText: "My next question" } });
    release!();
    await sending;
    assert.equal(ctx.store.get(conv.id).draftText, "My next question");
  } finally { release!(); await app.close(); }
});

test("deleting during generation does not recreate the conversation", async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const wait = new Promise<void>(r => { release = r; });
  const client = { chat: { completions: { create: async () => { entered(); await wait; return once("late reply"); } } } };
  const { app, ctx } = harness({ resolve: () => ({ client, model: "m" }) });
  try {
    const conv = ctx.store.create("m"); conv.title = "Existing chat"; ctx.store.save(conv);
    const response = app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Hello" } });
    const running = response.then(r => r);
    await started;
    assert.equal((await app.inject({ method: "DELETE", url: `/api/chat/conversations/${conv.id}` })).statusCode, 204);
    release(); await running;
    assert.equal(ctx.store.get(conv.id), null);
  } finally { release(); await app.close(); }
});

test('unconfigured Home Assistant cannot be enabled and stale chat flags offer no home tools', async () => {
  let configured = false;
  const requests: any[] = [];
  const { app, ctx } = harness({
    isHomeAssistantConfigured: () => configured,
    haTools: [{ name: 'get_entities', description: 'HA tool', parameters: {}, handler: async () => [] }],
    resolve: () => ({ client: recordingClient(requests), model: 'm' }),
  });
  try {
    assert.equal((await app.inject('/api/chat/tools')).json().homeAssistant, false);
    let res = await app.inject({ method: 'POST', url: '/api/chat/conversations', payload: { homeAssistant: true } });
    assert.equal(res.statusCode, 409);
    const conv = ctx.store.create('m', true);
    conv.title = 'Saved conversation';
    ctx.store.save(conv);
    res = await app.inject({ method: 'PATCH', url: `/api/chat/conversations/${conv.id}`, payload: { homeAssistant: true } });
    assert.equal(res.statusCode, 409);
    res = await app.inject({ method: 'POST', url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: 'Hello' } });
    assert.ok(sseEvents(res.body).some(e => e.type === 'done'));
    assert.ok(!(requests[0].tools ?? []).some((tool: any) => tool.function.name === 'get_entities'));
    configured = true;
    assert.equal((await app.inject('/api/chat/tools')).json().homeAssistant, true);
    res = await app.inject({ method: 'PATCH', url: `/api/chat/conversations/${conv.id}`, payload: { homeAssistant: true } });
    assert.equal(res.statusCode, 200);
    configured = false;
    res = await app.inject({ method: 'PATCH', url: `/api/chat/conversations/${conv.id}`, payload: { homeAssistant: false } });
    assert.equal(res.statusCode, 200);
  } finally { await app.close(); }
});

test("effort is validated, persisted, sent to the model, and reset on incompatible model changes", async () => {
  const requests: any[] = [];
  const { app } = harness({
    getEffortLevels: (model: string) => model === "local::m" ? ["low", "high"] : [],
    resolve: () => ({ model: "m", client: { chat: { completions: { create: async (params: any) => {
      requests.push(params);
      return params.stream ? once("Hello") : { choices: [{ message: { content: "Title" } }] };
    } } } } }),
  } as any);
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const url = `/api/chat/conversations/${conv.id}`;
    let res = await app.inject({ method: "PATCH", url, payload: { reasoningEffort: "high" } });
    assert.equal(res.json().reasoningEffort, "high");
    assert.equal((await app.inject({ method: "GET", url })).json().reasoningEffort, "high");
    res = await app.inject({ method: "PATCH", url, payload: { reasoningEffort: "max" } });
    assert.equal(res.statusCode, 400);
    assert.equal((await app.inject({ method: "GET", url })).json().reasoningEffort, "high");
    await app.inject({ method: "POST", url: url + "/messages", payload: { content: "Hello" } });
    assert.equal(requests.find(p => p.stream)?.reasoning_effort, "high");
    res = await app.inject({ method: "PATCH", url, payload: { model: "local::unknown" } });
    assert.equal(res.json().reasoningEffort, null);
    res = await app.inject({ method: "PATCH", url, payload: { reasoningEffort: null } });
    assert.equal(res.statusCode, 200);
  } finally { await app.close(); }
});

test("unselected effort defaults to medium only when supported and preserves explicit choices", async () => {
  const requests: any[] = [];
  const { app } = harness({
    getEffortLevels: (model: string) => model === "local::m" ? ["low", "medium", "high"] : ["low", "high"],
    resolve: () => ({ model: "m", client: { chat: { completions: { create: async (params: any) => {
      requests.push(params);
      return params.stream ? once("Hello") : { choices: [{ message: { content: "Title" } }] };
    } } } } }),
  } as any);
  try {
    const conv = (await app.inject({ method: "POST", url: "/api/chat/conversations", payload: {} })).json();
    const url = `/api/chat/conversations/${conv.id}`;
    await app.inject({ method: "POST", url: url + "/messages", payload: { content: "Hello" } });
    assert.equal(requests.filter(p => p.stream).at(-1).reasoning_effort, "medium");
    await app.inject({ method: "PATCH", url, payload: { reasoningEffort: "high" } });
    await app.inject({ method: "POST", url: url + "/messages", payload: { content: "Hello" } });
    assert.equal(requests.filter(p => p.stream).at(-1).reasoning_effort, "high");
    await app.inject({ method: "PATCH", url, payload: { model: "local::other", reasoningEffort: null } });
    await app.inject({ method: "POST", url: url + "/messages", payload: { content: "Hello" } });
    assert.equal(Object.hasOwn(requests.filter(p => p.stream).at(-1), "reasoning_effort"), false);
  } finally { await app.close(); }
});

test("regeneration replaces an answer and later turns using only the original prompt and attachments", async () => {
  const requests: any[] = [];
  const { app, ctx } = harness({ resolve: () => ({ client: recordingClient(requests), model: "m" }) });
  try {
    const conv = ctx.store.create("m");
    conv.title = "Existing";
    conv.draftText = "Keep my next draft";
    conv.messages = [
      { role: "user", content: "First" }, { role: "assistant", content: "Earlier" },
      { role: "user", content: "Try this", attachments: [{ id: "123456abcdef", name: "notes.txt", kind: "text" }] },
      { role: "assistant", content: "Old answer" }, { role: "user", content: "Later prompt" }, { role: "assistant", content: "Later answer" },
    ];
    ctx.store.save(conv);
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { regenerateFrom: 2, expectedMessageCount: 6 } });
    assert.ok(sseEvents(res.body).some(e => e.type === "done"));
    assert.deepEqual(requests[0].messages.map((m: any) => m.role), ["system", "user", "assistant", "user"]);
    assert.match(requests[0].messages.at(-1).content, /Try this.*notes.txt/s);
    const saved = ctx.store.get(conv.id);
    assert.deepEqual(saved.messages.map((m: any) => m.content), ["First", "Earlier", "Try this", "done"]);
    assert.equal(saved.draftText, "Keep my next draft");
    assert.equal(saved.messages[2].attachments[0].id, "123456abcdef");
  } finally { await app.close(); }
});

test("invalid or stale regeneration cannot change a conversation", async () => {
  const { app, ctx } = harness();
  try {
    const conv = ctx.store.create("m");
    conv.messages = [{ role: "user", content: "Question" }, { role: "assistant", content: "Answer" }];
    ctx.store.save(conv);
    for (const payload of [
      { regenerateFrom: -1, expectedMessageCount: 2 }, { regenerateFrom: 1, expectedMessageCount: 2 },
      { regenerateFrom: 0.5, expectedMessageCount: 2 }, { regenerateFrom: 0, expectedMessageCount: 4 },
    ]) {
      const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload });
      assert.ok([400, 409].includes(res.statusCode));
      assert.deepEqual(ctx.store.get(conv.id).messages, conv.messages);
    }
  } finally { await app.close(); }
});

test("failed regeneration keeps the original answer and later history", async () => {
  const { app, ctx } = harness({ resolve: () => { throw new Error("Provider unavailable"); } });
  try {
    const conv = ctx.store.create("m");
    conv.messages = [{ role: "user", content: "Question" }, { role: "assistant", content: "Keep this" }, { role: "user", content: "Later" }];
    ctx.store.save(conv);
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { regenerateFrom: 0, expectedMessageCount: 3 } });
    assert.match(sseEvents(res.body).find(e => e.type === "error").message, /Provider unavailable/);
    assert.deepEqual(ctx.store.get(conv.id).messages, conv.messages);
  } finally { await app.close(); }
});

test("message read-aloud strips hidden markers and speech tags and returns audio", async () => {
  const spoken: string[] = [];
  const { app } = harness({ synthesize: async (text: string) => { spoken.push(text); return Buffer.from("RIFF-test"); } } as any);
  try {
    const res = await app.inject({ method: "POST", url: "/api/chat/speech", payload: { text: "<expression:happy>Hello [laugh] there." } });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] as string, /audio\/wav/);
    assert.deepEqual(spoken, ["Hello there."]);
    for (const text of ["", "<expression:happy>", "x".repeat(2001)]) {
      assert.equal((await app.inject({ method: "POST", url: "/api/chat/speech", payload: { text } })).statusCode, 400);
    }
  } finally { await app.close(); }
});

test("cancelled regeneration preserves history and concurrent turns are rejected", async () => {
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let wasAborted = false;
  const client = { chat: { completions: { create: async (_body: any, opts: any) => {
    started();
    return (async function* () {
      yield { choices: [{ delta: { content: "Partial replacement" } }] };
      await new Promise<void>(resolve => {
        if (opts.signal.aborted) { wasAborted = true; resolve(); }
        else opts.signal.addEventListener("abort", () => { wasAborted = true; resolve(); }, { once: true });
      });
      opts.signal.throwIfAborted();
    })();
  } } } };
  const { app, ctx } = harness({ resolve: () => ({ client, model: "m" }) });
  const conv = ctx.store.create("m");
  conv.title = "Existing chat";
  conv.messages = [{ role: "user", content: "Original" }, { role: "assistant", content: "Keep this answer" }];
  ctx.store.save(conv);
  const controller = new AbortController();
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${address}/api/chat/conversations/${conv.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerateFrom: 0, expectedMessageCount: 2 }), signal: controller.signal,
    });
    await ready;
    const blocked = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "Overlap" } });
    assert.equal(blocked.statusCode, 409);
    const body = response.text().catch(() => "");
    controller.abort();
    await body;
    for (let i = 0; i < 50 && !wasAborted; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(wasAborted, true, "client disconnect reaches model request");
    assert.deepEqual(ctx.store.get(conv.id)?.messages, conv.messages);
  } finally { controller.abort(); await app.close(); }
});

test("explicit cancellation aborts title generation and releases the turn lock", async () => {
  let reachedTitle!: () => void;
  const titleStarted = new Promise<void>(resolve => { reachedTitle = resolve; });
  let titleAborted = false;
  const client = { chat: { completions: { create: async (body: any, opts: any) => {
    if (body.stream) return once("Replacement");
    reachedTitle();
    await new Promise<void>(resolve => opts.signal.addEventListener("abort", () => { titleAborted = true; resolve(); }, { once: true }));
    opts.signal.throwIfAborted();
  } } } };
  const { app, ctx } = harness({ resolve: () => ({ client, model: "m" }) });
  const conv = ctx.store.create("m");
  conv.messages = [{ role: "user", content: "Hello" }, { role: "assistant", content: "Original" }];
  ctx.store.save(conv);
  try {
    const pending = app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { regenerateFrom: 0, expectedMessageCount: 2 } }).then(r => r);
    await titleStarted;
    const cancelled = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/cancel` });
    assert.equal(cancelled.statusCode, 204);
    await pending;
    assert.equal(titleAborted, true);
    assert.deepEqual(ctx.store.get(conv.id)?.messages, conv.messages);
    const next = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content: "/help" } });
    assert.equal(next.statusCode, 200);
  } finally { await app.close(); }
});
