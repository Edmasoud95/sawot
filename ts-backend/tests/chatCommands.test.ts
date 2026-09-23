import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes, type ChatCtx } from "../src/chatRoutes.js";

function setup(t: any, options: Partial<ChatCtx> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sawot-commands-"));
  const app = Fastify();
  const store = new ChatStore(join(dir, "conversations"));
  mkdirSync(join(dir, "uploads"));
  const requests: any[] = [];
  const client = { apiKey: "never-expose", chat: { completions: { create: async function* (body: any) {
    requests.push(body); yield { choices: [{ delta: { content: "Hello" } }] };
  } } } };
  const ctx: ChatCtx = { store, resolve: () => ({ client, model: "test-model", providerId: "cloud", providerName: "Test provider" }),
    haTools: [], searchTools: [], ha: null, uploadDir: join(dir, "uploads"), name: "SAWOT",
    getEntitySummary: () => "", getChatInstructions: () => "", getDefaultModel: () => "cloud::test-model", ...options };
  registerChatRoutes(app, ctx);
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const conv = store.create("cloud::test-model");
  conv.title = "Test chat";
  conv.messages = [{ role: "user", content: "Remember this history. ".repeat(100) }, { role: "assistant", content: "I will." }];
  store.save(conv);
  const send = async (content: string, attachments: any[] = []) => {
    const res = await app.inject({ method: "POST", url: `/api/chat/conversations/${conv.id}/messages`, payload: { content, attachments } });
    return res.body.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
  };
  const status = async () => (await send("/status")).find(e => e.type === "done")?.message;
  return { store, conv, ctx, requests, send, status };
}

test("status describes current context and repeated commands never reach the model", async t => {
  const h = setup(t);
  const first = await h.status();
  assert.deepEqual(h.store.get(h.conv.id).messages, h.conv.messages, "commands and results must not be saved as messages");
  assert.equal(h.requests.length, 0);
  assert.equal(first.command, "status");
  assert.equal(first.status.capacity, 128000);
  assert.equal(first.status.source, "default");
  assert.ok(first.status.used > 500);
  assert.equal(first.status.remaining, 128000 - first.status.used);
  assert.match(first.content, /estimated/i);
  assert.match(first.content, /assumed/i);
  assert.doesNotMatch(first.content, /never-expose|last reply|apiKey/);
  assert.equal((await h.status()).status.used, first.status.used);
  await h.send("Continue");
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].messages.length, 4, "system, two earlier messages, and the new user message");
  assert.equal(h.requests[0].messages[1].content, h.conv.messages[0].content);
});

test("status counts instructions, enabled tool schemas, history and text attachments", async t => {
  const h = setup(t, { getChatInstructions: () => "instruction ".repeat(200) });
  const first = await h.status();
  const conv = h.store.get(h.conv.id);
  conv.homeAssistant = true;
  h.ctx.haTools.push({ name: "fake_tool", description: "tool description ".repeat(200), parameters: { type: "object", properties: {} }, execute: async () => { throw new Error("must not execute"); } } as any);
  h.ctx.getEntitySummary = () => "entities ".repeat(200);
  writeFileSync(join(h.ctx.uploadDir, "123456abcdef.txt"), "attachment content ".repeat(200));
  conv.messages.push({ role: "user", content: "Read this", attachments: [{ id: "123456abcdef", name: "notes.txt", kind: "text" }] });
  h.store.save(conv);
  assert.ok((await h.status()).status.used > first.status.used + 1500);
  assert.equal(h.requests.length, 0);
});

test("status reports live local capacity and never shows negative remaining space", async t => {
  const h = setup(t, { getContextInfo: async () => ({ tokens: 100, source: "loaded" }) });
  const result = await h.status();
  assert.equal(result.status.capacity, 100);
  assert.equal(result.status.source, "loaded");
  assert.equal(result.status.remaining, 0);
  assert.match(result.content, /over/i);
  assert.match(result.content, /LM Studio.*loaded/i);
});

test("pending images get an explicit allowance without treating base64 as text", async t => {
  const h = setup(t);
  const before = await h.status();
  writeFileSync(join(h.ctx.uploadDir, "123456abcdef.png"), Buffer.alloc(100000));
  const result = (await h.send("/status", [{ id: "123456abcdef", kind: "image", name: "photo.png" }])).find(e => e.type === "done").message;
  assert.equal(result.status.images, 1);
  assert.ok(result.status.used > before.status.used);
  assert.ok(result.status.used < before.status.used + 3000);
  assert.match(result.content, /image.*rough/i);
  assert.equal((await h.status()).status.used, before.status.used, "pending command attachments must not become model history");
});

test("help lists commands without resolving or calling a model", async t => {
  const h = setup(t, { resolve: () => { throw new Error("must not resolve"); } });
  const result = (await h.send("  /HELP  ")).find(e => e.type === "done").message;
  assert.equal(result.command, "help");
  assert.match(result.content, /\/status/);
  assert.match(result.content, /\/help/);
});

test("commands do not promote empty chats or persist failed results", async t => {
  const h = setup(t, { resolve: () => { throw new Error("metadata offline"); } });
  h.conv.messages = [];
  h.store.save(h.conv);
  await h.send("/help");
  assert.deepEqual(h.store.list(), []);
  const result = await h.send("/status");
  assert.ok(result.some(e => e.type === "error"));
  assert.deepEqual(h.store.get(h.conv.id).messages, []);
});

test("legacy command entries are absent from loaded chats and sidebar history", async t => {
  const h = setup(t);
  h.conv.messages = [{ role: "user", command: "status", content: "/status" },
    { role: "assistant", command: "status", content: "Old result" }];
  h.store.save(h.conv);
  assert.deepEqual(h.store.get(h.conv.id).messages, []);
  assert.deepEqual(h.store.list(), []);
});
