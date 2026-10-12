import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({ stdin: { contents: 'export { useChatStore } from "./chatStore"; export { invalidateMemory } from "./lib/memoryApi";', resolveDir: new URL("../src/", import.meta.url).pathname, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" } });
Object.assign(globalThis, { window: { matchMedia: () => ({ matches: true }) }, location: { protocol: "http:", host: "localhost" }, localStorage: { getItem: () => null } });
const { useChatStore: store, invalidateMemory } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=chatStore-test.mjs").toString("base64")}`);

test("status preserves pending attachments for the next model message", async (t) => {
  t.after(() => store.setState({ pendingAttachments: [], conversations: [], active: null, activeId: null, streaming: false }));
  const attachment = { id: "123456abcdef", kind: "image", name: "photo.png" };
  store.setState({ activeId: "command", active: { id: "command", title: "New chat", model: "m", messages: [], draftText: "/status" },
    conversations: [], streaming: false, pendingAttachments: [attachment] });
  let payload: any;
  globalThis.fetch = async (_url, init: any) => {
    if (init.method === "PATCH") return new Response('{}');
    payload = JSON.parse(init.body);
    return new Response('data: {"type":"done","message":{"role":"assistant","content":"Chat status","command":"status"}}\n\n');
  };
  await store.getState().startStream("/status");
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(payload.attachments, [attachment], "status can include the pending attachment in its estimate");
  assert.deepEqual(store.getState().pendingAttachments, [attachment]);
  assert.deepEqual(store.getState().active.messages, []);
  assert.deepEqual(store.getState().conversations, []);
  assert.equal(store.getState().commandResult.content, "Chat status");
  store.getState().dismissCommand();
  assert.equal(store.getState().commandResult, null);
  store.setState({ pendingAttachments: [] });
});

test("dismissed command requests cannot reopen the drawer with a late result", async () => {
  store.setState({ activeId: "late-command", active: { id: "late-command", messages: [], draftText: "/status" }, conversations: [], streaming: false });
  let release!: (response: Response) => void;
  globalThis.fetch = async (_url, init: any) => init.method === "PATCH" ? new Response('{}') : new Promise(resolve => { release = resolve; });
  await store.getState().startStream("/status");
  assert.equal(store.getState().commandResult.loading, true);
  store.getState().dismissCommand();
  release(new Response('data: {"type":"done","message":{"role":"assistant","content":"Late status","command":"status"}}\n\n'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(store.getState().commandResult, null);
  assert.deepEqual(store.getState().active.messages, []);
});

test("new chats stay hidden; short drafts are preserved without appearing in history", async () => {
  const records = new Map<string, any>();
  globalThis.fetch = async (_url, init: any = {}) => {
    const url = String(_url);
    let result: any;
    if (init.method === "POST") {
      result = { id: String(records.size + 1), title: "New chat", messages: [], updated: 1 };
      records.set(result.id, result);
    } else if (init.method === "PATCH") {
      const id = url.split("/").at(-1)!;
      result = { ...records.get(id), ...JSON.parse(init.body) };
      records.set(id, result);
    } else result = records.get(url.split("/").at(-1)!);
    return new Response(JSON.stringify(result));
  };
  await store.getState().newConversation();
  const first = store.getState().activeId;
  assert.equal(store.getState().conversations.length, 0, "New Chat must not add an empty row");
  store.getState().setDraftText("hello there");
  assert.equal(store.getState().conversations.length, 0);
  store.getState().setDraftText("Plan my weekend");
  assert.equal(store.getState().conversations[0].title, "Draft: Plan my weekend");
  await store.getState().newConversation();
  assert.equal(store.getState().active.draftText ?? "", "");
  await store.getState().openConversation(first);
  assert.equal(store.getState().active.draftText, "Plan my weekend");
  store.getState().setDraftText("Plan my");
  assert.equal(store.getState().conversations.length, 0);
  await store.getState().flushDraft();
  assert.equal(records.get(first).draftText, "Plan my");
});

test("sending a one-word message promotes history and clears the draft", async () => {
  store.setState({ activeId: "sent", active: { id: "sent", title: "New chat", messages: [], draftText: "Hello" }, conversations: [], streaming: false });
  globalThis.fetch = async () => new Response('data: {"type":"done","message":{"role":"assistant","content":"Hi"},"title":"Greeting"}\n\n');
  await store.getState().startStream("Hello");
  assert.equal(store.getState().active.draftText, "");
  assert.equal(store.getState().conversations.length, 1);
  assert.equal(store.getState().conversations[0].isDraft, false);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("stopping while a draft save is pending does not send the message afterward", async () => {
  store.setState({ activeId: "cancel", active: { id: "cancel", title: "New chat", messages: [], draftText: "" }, conversations: [], streaming: false });
  let release: () => void;
  const saving = new Promise<void>(resolve => { release = resolve; });
  const messages: string[] = [];
  globalThis.fetch = async (url, init: any) => {
    if (init.method === "PATCH") { await saving; return new Response('{}'); }
    messages.push(String(url));
    return new Response('');
  };
  store.getState().setDraftText("Please save this");
  const sending = store.getState().startStream("Please save this");
  store.getState().stopStream();
  release!();
  await sending;
  assert.deepEqual(messages, [], "cancelled preparation must not send a message");
  assert.equal(store.getState().active.draftText, "Please save this");
});

test("a failed old draft never overwrites a newer queued successful save", async () => {
  store.setState({ activeId: "retry", active: { id: "retry", title: "New chat", messages: [] }, conversations: [], streaming: false });
  let rejectOld: (e: Error) => void;
  const old = new Promise<Response>((_, reject) => { rejectOld = reject; });
  const writes: string[] = [];
  globalThis.fetch = async (_url, init: any) => {
    writes.push(JSON.parse(init.body).draftText);
    if (writes.length === 1) return old;
    return new Response('{}');
  };
  store.getState().setDraftText("old draft text");
  const first = store.getState().flushDraft().catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 0));
  store.getState().setDraftText("new latest draft text");
  const second = store.getState().flushDraft();
  rejectOld!(new Error("offline"));
  await first;
  await second;
  await store.getState().flushDraft();
  assert.deepEqual(writes, ["old draft text", "new latest draft text"]);
});

test("large drafts use ordinary requests so they can still be sent", async () => {
  store.setState({ activeId: "large", active: { id: "large", title: "New chat", messages: [] }, conversations: [], streaming: false });
  const text = "word ".repeat(15000);
  globalThis.fetch = async (_url, init: any) => {
    if (init.keepalive && new TextEncoder().encode(init.body).length > 65536) throw new TypeError("keepalive body limit");
    return new Response('{}');
  };
  store.getState().setDraftText(text);
  await store.getState().flushDraft();
  assert.equal(store.getState().draftError, "");
});

test("deletion discards drafts typed while waiting and reports HTTP failures", async () => {
  const chat = { id: "delete-race", title: "Test", messages: [], draftText: "" };
  store.setState({ activeId: chat.id, active: chat, conversations: [chat], pendingAttachments: [{ id: "file" }] });
  let release!: (response: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>(r => { started = r; });
  globalThis.fetch = async (_url, init: any) => {
    if (init.method === "DELETE") { started(); return new Promise(r => { release = r; }); }
    throw Error("Deleted draft must not be sent");
  };
  const deleting = store.getState().removeConversation(chat.id);
  await entered;
  store.getState().setDraftText("Draft during deletion");
  release(new Response(null, { status: 204 }));
  await deleting;
  await store.getState().flushDraft();
  assert.equal(store.getState().activeId, null);
  assert.deepEqual(store.getState().pendingAttachments, []);
  store.setState({ activeId: "delete-failure", active: { ...chat, id: "delete-failure" } });
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  await assert.rejects(store.getState().removeConversation("delete-failure"), /Could not delete/);
  assert.equal(store.getState().activeId, "delete-failure");
});

test("model changes adopt the server's effort reset without modifying another conversation", async () => {
  const active = { id: "a", model: "known", reasoningEffort: "high", messages: [] };
  store.setState({ activeId: "a", active, conversations: [active] });
  globalThis.fetch = async () => new Response(JSON.stringify({ model: "unknown", reasoningEffort: null }));
  await store.getState().renameModel("unknown");
  assert.equal(store.getState().active.reasoningEffort, null);
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
  const pending = store.getState().setEffort("high");
  store.setState({ activeId: "b", active: { id: "b", model: "other", reasoningEffort: null, messages: [] } });
  release(new Response(JSON.stringify({ reasoningEffort: "high" })));
  await pending;
  assert.equal(store.getState().active.reasoningEffort, null);
  assert.equal(store.getState().conversations[0].reasoningEffort, "high");
});

test("sending and model changes wait until the effort setting has saved", async () => {
  store.setState({ activeId: "a", active: { id: "a", model: "known", reasoningEffort: null, messages: [] }, conversations: [], streaming: false });
  let release!: (response: Response) => void;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Promise(resolve => { release = resolve; }); };
  const pending = store.getState().setEffort("high");
  assert.equal(store.getState().settingsSaving, true);
  await assert.rejects(store.getState().renameModel("unknown"), /saving/i);
  await store.getState().startStream("Hello");
  assert.equal(requests, 1, "send must not race a settings write");
  release(new Response(JSON.stringify({ model: "known", reasoningEffort: "high" })));
  await pending;
  assert.equal(store.getState().settingsSaving, false);
  assert.equal(store.getState().active.reasoningEffort, "high");
});

test("regeneration replaces the selected turn without consuming the current draft or attachments", async () => {
  const messages = [{ role: "user", content: "First" }, { role: "assistant", content: "Old" }, { role: "user", content: "Later" }, { role: "assistant", content: "Later answer" }];
  const attachment = { id: "abc123abcdef", name: "next.txt" };
  store.setState({ activeId: "regen", active: { id: "regen", messages, draftText: "My unsent next prompt" }, conversations: [], pendingAttachments: [attachment], streaming: false });
  let payload: any;
  globalThis.fetch = async (_url, init: any) => {
    payload = JSON.parse(init.body);
    return new Response('data: {"type":"regenerating","from":0}\n\ndata: {"type":"done","message":{"role":"assistant","content":"New answer"}}\n\n');
  };
  await store.getState().regenerateMessage(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(payload, { regenerateFrom: 0, expectedMessageCount: 4 });
  assert.deepEqual(store.getState().active.messages.map((m: any) => m.content), ["First", "New answer"]);
  assert.equal(store.getState().active.draftText, "My unsent next prompt");
  assert.deepEqual(store.getState().pendingAttachments, [attachment]);
});

test("failed regeneration restores the existing messages and reports the failure separately", async () => {
  const messages = [{ role: "user", content: "First" }, { role: "assistant", content: "Keep answer" }];
  store.setState({ activeId: "regen", active: { id: "regen", messages }, conversations: [], streaming: false });
  globalThis.fetch = async (url) => String(url).endsWith("/messages") ? new Response('data: {"type":"regenerating","from":0}\n\ndata: {"type":"error","message":"Provider unavailable"}\n\n') : String(url).endsWith("/cancel") ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ messages }));
  assert.equal(typeof store.getState().regenerateMessage, "function");
  await store.getState().regenerateMessage(0);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(store.getState().active.messages, messages);
  assert.match(store.getState().messageError, /Provider unavailable/);
});

test("a lost regeneration acknowledgement reloads committed history before allowing another send", async () => {
  const messages = [{ role: "user", content: "First" }, { role: "assistant", content: "Old" }, { role: "user", content: "Later" }];
  const saved = [messages[0], { role: "assistant", content: "Saved replacement" }];
  store.setState({ activeId: "lost", active: { id: "lost", messages }, conversations: [], streaming: false, reconciling: false });
  let release!: (r: Response) => void;
  globalThis.fetch = async (url) => String(url).endsWith("/messages")
    ? new Response('data: {"type":"regenerating","from":0}\n\n')
    : String(url).endsWith("/cancel") ? new Response(null, { status: 204 })
    : new Promise(resolve => { release = resolve; });
  await store.getState().regenerateMessage(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(store.getState().reconciling, true);
  await store.getState().startStream("Must wait");
  assert.equal(store.getState().streaming, false);
  release(new Response(JSON.stringify({ messages: saved, title: "Saved" })));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(store.getState().active.messages, saved);
  assert.equal(store.getState().reconciling, false);
});

test("rejected sends restore their prompt and attachments without phantom history", async () => {
  const messages = [{ role: "user", content: "First" }, { role: "assistant", content: "Old" }];
  const attachment = { id: "pending" };
  store.setState({ activeId: "busy", active: { id: "busy", messages, draftText: "Try this again" }, conversations: [], pendingAttachments: [attachment], streaming: false, reconciling: false });
  globalThis.fetch = async (_url, init: any) => init.method === "POST"
    ? new Response(JSON.stringify({ detail: "Conversation still responding" }), { status: 409 })
    : new Response('{}');
  await store.getState().startStream("Try this again");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(store.getState().active.messages, messages);
  assert.equal(store.getState().active.draftText, "Try this again");
  assert.deepEqual(store.getState().pendingAttachments, [attachment]);
  await store.getState().flushDraft();
});

function interruptedChat() {
  store.setState({ activeId: "interrupted", active: { id: "interrupted", title: "Test", messages: [], draftText: "" },
    conversations: [], streaming: false, backgroundResponding: false, reconciling: false, retryRecovery: null, pendingAttachments: [], messageError: "" });
  let stream!: ReadableStreamDefaultController;
  const response = new Response(new ReadableStream({ start(controller) {
    stream = controller;
    controller.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"Partial answer"}\n\n'));
  } }));
  return { response, fail: () => stream.error(new TypeError("Type error")), close: () => stream.close(), emit: (event: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)) };
}

const settleStream = () => new Promise(resolve => setTimeout(resolve, 10));

test("an interrupted chat preserves partial text and reloads saved history without resending", async () => {
  const stream = interruptedChat();
  const requests: string[] = [];
  let release!: (response: Response) => void;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/messages")) return stream.response;
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    return new Promise(resolve => { release = resolve; });
  };
  await store.getState().startStream("Question");
  await settleStream();
  stream.fail();
  await settleStream();
  assert.equal(store.getState().active.messages.at(-1).content, "Partial answer");
  assert.doesNotMatch(store.getState().messageError, /TypeError|Type error/);
  assert.equal(store.getState().reconciling, true);
  await store.getState().startStream("Must wait");
  const saved = [{ role: "user", content: "Question" }, { role: "assistant", content: "Saved answer" }];
  store.setState(s => ({ active: { ...s.active, draftText: "Next question" }, pendingAttachments: [{ id: "next" }] }));
  release(new Response(JSON.stringify({ title: "Saved", messages: saved })));
  await settleStream();
  assert.deepEqual(store.getState().active.messages, saved);
  assert.equal(store.getState().active.draftText, "Next question");
  assert.deepEqual(store.getState().pendingAttachments, [{ id: "next" }]);
  assert.equal(store.getState().reconciling, false);
  assert.equal(requests.filter(url => url.endsWith("/messages")).length, 1);
  assert.equal(requests.some(url => url.endsWith("/cancel")), false, "recovery must never cancel generation");
});

test("offline recovery can retry once connectivity returns without duplicating requests", async () => {
  const stream = interruptedChat();
  let online = false;
  let reloads = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/messages")) return stream.response;
    if (!online) throw new TypeError("Failed to fetch");
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    reloads++;
    return new Response(JSON.stringify({ messages: [{ role: "user", content: "Question" }], title: "Saved" }));
  };
  await store.getState().startStream("Question");
  await settleStream();
  stream.fail();
  await settleStream();
  assert.equal(store.getState().reconciling, true);
  assert.equal(typeof store.getState().retryRecovery, "function");
  online = true;
  await Promise.all([store.getState().retryRecovery(), store.getState().retryRecovery()]);
  assert.equal(reloads, 1);
  assert.equal(store.getState().reconciling, false);
  assert.equal(store.getState().retryRecovery, null);
});

test("a clean stream close without a done acknowledgement also recovers history", async () => {
  const stream = interruptedChat();
  let reloads = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/messages")) return stream.response;
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    reloads++;
    return new Response(JSON.stringify({ messages: [{ role: "assistant", content: "Saved" }], title: "Saved" }));
  };
  await store.getState().startStream("Question");
  await settleStream();
  stream.close();
  await settleStream();
  assert.equal(reloads, 1);
  assert.equal(store.getState().active.messages.at(-1).content, "Saved");
});

test("a late recovery cannot overwrite another conversation", async () => {
  const stream = interruptedChat();
  let release!: (response: Response) => void;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/messages")) return stream.response;
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/other")) return new Response(JSON.stringify({ id: "other", messages: [], title: "Other" }));
    return new Promise(resolve => { release = resolve; });
  };
  await store.getState().startStream("Question");
  await settleStream();
  stream.fail();
  await settleStream();
  assert.equal(typeof release, "function");
  await store.getState().openConversation("other");
  release(new Response(JSON.stringify({ messages: [{ role: "assistant", content: "Stale" }] })));
  await settleStream();
  assert.equal(store.getState().activeId, "other");
  assert.deepEqual(store.getState().active.messages, []);
  assert.equal(store.getState().retryRecovery, null);
});

test("a disconnected request that never reached the server restores its draft and attachments", async () => {
  interruptedChat();
  const attachment = { id: "unsent", kind: "image" };
  store.setState({ pendingAttachments: [attachment] });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/messages")) throw new TypeError("Type error");
    if (String(url).endsWith("/cancel")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ title: "Test", messages: [] }));
  };
  await store.getState().startStream("Unsent question");
  await settleStream();
  assert.equal(store.getState().active.draftText, "Unsent question");
  assert.deepEqual(store.getState().pendingAttachments, [attachment]);
  assert.deepEqual(store.getState().active.messages, []);
});

test("reopening a response catches up once and resumes live UI without resending", async (t) => {
  interruptedChat();
  t.after(() => store.getState().detachStream());
  let live!: ReadableStreamDefaultController;
  const requests: string[] = [];
  const running = { id: "running", title: "Running", responding: true,
    messages: [{ role: "user", content: "Question" }, { role: "assistant", content: "Partial", thinking: "Reasoning" }] };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).endsWith("/stream")) return new Response(new ReadableStream({ start(c) {
      live = c;
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "snapshot", conversation: running })}\n\n`));
    } }));
    return new Response(JSON.stringify(running));
  };
  await store.getState().openConversation("running");
  await settleStream();
  assert.equal(store.getState().streaming, true);
  assert.equal(store.getState().messageError, "");
  assert.equal(store.getState().streamText, "Partial");
  assert.equal(store.getState().streamThinking, "Reasoning");
  assert.equal(store.getState().active.messages.length, 1);
  let renders = 0;
  const unsubscribe = store.subscribe(() => renders++);
  for (let i = 0; i < 100; i++) live.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"!"}\n\n'));
  await new Promise(r => setTimeout(r, 80));
  unsubscribe();
  assert.equal(store.getState().streamText, "Partial" + "!".repeat(100));
  assert.ok(renders < 10, `burst caused ${renders} store updates`);
  live.enqueue(new TextEncoder().encode('data: {"type":"done","message":{"role":"assistant","content":"Complete"}}\n\n'));
  live.close();
  await settleStream();
  assert.equal(store.getState().streaming, false);
  assert.equal(store.getState().active.messages.at(-1).content, "Complete");
  assert.equal(store.getState().messageError, "");
  assert.equal(requests.filter(u => u.endsWith("/stream")).length, 1);
  assert.equal(requests.some(u => u.endsWith("/messages") || u.endsWith("/cancel")), false);
});

test("Stop explicitly cancels a response even after the browser stream disconnected", async () => {
  interruptedChat();
  store.setState({ activeId: "running", active: { id: "running", messages: [] }, backgroundResponding: true, reconciling: true });
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return String(url).endsWith("/cancel") ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ id: "running", responding: false, messages: [{ role: "assistant", content: "Stopped" }] }));
  };
  await store.getState().stopStream();
  await settleStream();
  assert.equal(requests.filter(url => url.endsWith("/cancel")).length, 1);
  assert.equal(store.getState().active.messages.at(-1).content, "Stopped");
  assert.equal(store.getState().backgroundResponding, false);
});

test("switching conversations detaches the browser without cancelling the model", async () => {
  const stream = interruptedChat();
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return String(url).endsWith("/messages") ? stream.response
      : new Response(JSON.stringify({ id: "other", title: "Other", messages: [], responding: false }));
  };
  await store.getState().startStream("Question");
  await settleStream();
  await store.getState().openConversation("other");
  stream.close();
  await settleStream();
  assert.equal(requests.some(url => url.endsWith("/cancel")), false);
  assert.equal(store.getState().activeId, "other");
  assert.deepEqual(store.getState().active.messages, []);
});

test("detaching a live stream keeps its visible text while the next snapshot loads", async () => {
  const stream = interruptedChat();
  globalThis.fetch = async () => stream.response;
  await store.getState().startStream("Question");
  await settleStream();
  store.getState().detachStream();
  stream.close();
  await settleStream();
  assert.equal(store.getState().active.messages.at(-1).content, "Partial answer");
  assert.equal(store.getState().streaming, false);
});

test("recovery retries a transient network failure without another focus event", async (t) => {
  interruptedChat();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  globalThis.fetch = async () => {
    if (++reads === 1) throw new TypeError("network");
    return new Response(JSON.stringify({ title: "Saved", messages: [{ role: "assistant", content: "Complete answer" }], responding: false }));
  };
  await store.getState().recoverConversation("interrupted");
  assert.equal(reads, 1);
  t.mock.timers.tick(1000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(store.getState().active.messages.at(-1).content, "Complete answer");
  assert.equal(store.getState().messageError, "");
  store.getState().detachStream();
});

test("a stalled recovery request times out and retries instead of blocking all focus events", async (t) => {
  interruptedChat();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  let reads = 0;
  globalThis.fetch = async (_url, init) => {
    if (++reads > 1) return new Response(JSON.stringify({ title: "Saved", messages: [], responding: false }));
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  const recovery = store.getState().recoverConversation("interrupted");
  assert.ok(signal, "recovery GET must have a cancellation signal");
  t.mock.timers.tick(10000);
  await recovery;
  assert.equal(signal.aborted, true);
  t.mock.timers.tick(1000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(reads, 2);
  assert.equal(store.getState().reconciling, false);
  store.getState().detachStream();
});

test("resuming an idle chat refreshes a stale network error without reopening or resending", async () => {
  interruptedChat();
  store.setState({ active: { id: "interrupted", draftText: "Keep my draft", messages: [{ role: "assistant", content: "⚠ TypeError: network" }] } });
  const requests: string[] = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ title: "Saved", messages: [{ role: "assistant", content: "Saved answer" }], responding: false }));
  };
  assert.equal(typeof store.getState().resumeConversation, "function");
  await store.getState().resumeConversation();
  assert.equal(store.getState().active.messages.at(-1).content, "Saved answer");
  assert.equal(store.getState().active.draftText, "Keep my draft");
  assert.deepEqual(requests, ["/api/chat/conversations/interrupted"]);
});

test("memory activity survives interruption, reconciles once, and clears on navigation", async () => {
  const stream = interruptedChat();
  const event = { type: "memory", id: "saved-event", turnId: "turn", kind: "saved", created: "2026-10-02", memories: [{ id: "fact", revision: 1 }] };
  const requests: string[] = [];
  let release!: (response: Response) => void;
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url).endsWith("/messages")) return stream.response;
    return new Promise(resolve => { release = resolve; });
  };
  await store.getState().startStream("Remember my preference");
  stream.emit(event);
  stream.emit(event);
  await settleStream();
  assert.equal(store.getState().streamMemory.length, 1, "replayed operation replaces its existing indicator");
  stream.fail();
  await settleStream();
  assert.deepEqual(store.getState().active.messages.at(-1).memory, [event], "successful activity stays visible during reconciliation");
  release(new Response(JSON.stringify({ id: "interrupted", messages: [
    { role: "user", content: "Remember my preference" },
    { role: "assistant", content: "Saved answer", memory: [event] }
  ], responding: false })));
  await settleStream();
  assert.deepEqual(store.getState().active.messages.at(-1).memory, [event]);
  assert.equal(store.getState().active.messages.filter(message => message.memory?.length).length, 1);
  assert.equal(requests.filter(url => url.endsWith("/messages")).length, 1, "recovery must not repeat a memory operation");
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "other-memory-chat", messages: [], responding: false }));
  await store.getState().openConversation("other-memory-chat");
  assert.deepEqual(store.getState().streamMemory, []);
  assert.deepEqual(store.getState().active.messages, []);
  assert.equal(requests.some(url => url.endsWith("/cancel")), false);
});

test("memory invalidation removes snapshots and preserves active streaming", () => {
  const memory = [{ id: "event", kind: "recalled", created: "2026-10-02", memories: [{ id: "fact", revision: 2, text: "Private old value", current: { text: "Private current value" } }] }];
  const active = { id: "memory-invalidation", messages: [{ role: "assistant", content: "Answer", memory }] };
  store.setState({ activeId: active.id, active, streaming: true, streamText: "Still generating", streamMemory: memory });
  let refreshes = 0;
  const oldDispatch = window.dispatchEvent;
  window.dispatchEvent = event => { assert.equal(event.type, "sawot-memory-change"); refreshes++; return true; };
  try {
    invalidateMemory();
    const expected = [{ ...memory[0], memories: [{ id: "fact", revision: 2 }] }];
    assert.deepEqual(store.getState().streamMemory, expected);
    assert.deepEqual(store.getState().active.messages[0].memory, expected);
    assert.equal(store.getState().activeId, active.id);
    assert.equal(store.getState().streaming, true);
    assert.equal(store.getState().streamText, "Still generating");
    assert.equal(store.getState().active.messages[0].content, "Answer");
    assert.equal(refreshes, 1);
  } finally {
    window.dispatchEvent = oldDispatch;
    store.setState({ activeId: null, active: null, streaming: false, streamMemory: [], streamText: "" });
  }
});

test("editing replaces the prompt while preserving original attachments and the composer draft", async () => {
  const attachments = [{ id: "abc123abcdef", name: "original.txt" }];
  const pending = [{ id: "def123abcdef", name: "next.txt" }];
  store.setState({ activeId: "edit", active: { id: "edit", messages: [{ role: "user", content: "Original", attachments }, { role: "assistant", content: "Old" }], draftText: "Next draft" }, conversations: [], pendingAttachments: pending, streaming: false, reconciling: false });
  let payload: any;
  globalThis.fetch = async (_url, init: any) => {
    payload = JSON.parse(init.body);
    return new Response('data: {"type":"regenerating","from":0}\n\ndata: {"type":"done","message":{"role":"assistant","content":"New answer"}}\n\n');
  };
  assert.equal(typeof store.getState().editMessage, "function");
  await store.getState().editMessage(0, "Revised");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(payload, { regenerateFrom: 0, content: "Revised", expectedMessageCount: 2 });
  assert.deepEqual(store.getState().active.messages.map((m: any) => m.content), ["Revised", "New answer"]);
  assert.deepEqual(store.getState().active.messages[0].attachments, attachments);
  assert.equal(store.getState().active.draftText, "Next draft");
  assert.deepEqual(store.getState().pendingAttachments, pending);
});

test("failed editing restores original text and later messages", async () => {
  const messages = [{ role: "user", content: "Original" }, { role: "assistant", content: "Keep answer" }, { role: "user", content: "Later" }];
  store.setState({ activeId: "edit-fail", active: { id: "edit-fail", messages, draftText: "Next draft" }, conversations: [], streaming: false, reconciling: false });
  globalThis.fetch = async (url) => String(url).endsWith("/messages")
    ? new Response('data: {"type":"regenerating","from":0}\n\ndata: {"type":"error","message":"Provider unavailable"}\n\n')
    : new Response(JSON.stringify({ messages }));
  await store.getState().editMessage(0, "Revised");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(store.getState().active.messages, messages);
  assert.equal(store.getState().active.draftText, "Next draft");
  assert.match(store.getState().messageError, /Provider unavailable/);
});

test("history failure preserves cached conversations and retry clears the error", async () => {
  store.setState({ conversations: [{ id: "cached", title: "Existing chat" }], active: null, activeId: null });
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await store.getState().loadConversations(), false);
  assert.match(store.getState().historyError, /load conversations/i);
  assert.equal(store.getState().historyLoading, false);
  assert.equal(store.getState().conversations[0].id, "cached");
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: "fresh", title: "Reloaded chat" }]));
  assert.equal(await store.getState().loadConversations(), true);
  assert.equal(store.getState().historyError, "");
  assert.equal(store.getState().conversations[0].id, "fresh");
});

test("new chat creation reports pending and failure, preserves the open chat, and blocks duplicate requests", async () => {
  const active = { id: "existing", title: "Existing chat", messages: [], draftText: "" };
  store.setState({ active, activeId: active.id, streaming: false, pendingAttachments: [{ id: "kept" }] });
  let reject!: (error: Error) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  globalThis.fetch = async () => { requests++; started(); return new Promise((_resolve, fail) => { reject = fail; }); };
  const creation = store.getState().newConversation();
  await entered;
  assert.equal(store.getState().creatingConversation, true);
  assert.equal(await store.getState().newConversation(), false);
  assert.equal(requests, 1);
  reject(new Error("offline"));
  assert.equal(await creation, false);
  assert.equal(store.getState().creatingConversation, false);
  assert.match(store.getState().createError, /create.*conversation/i);
  assert.equal(store.getState().activeId, active.id);
  assert.deepEqual(store.getState().pendingAttachments, [{ id: "kept" }]);
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "created", messages: [], draftText: "" }));
  assert.equal(await store.getState().newConversation(), true);
  assert.equal(store.getState().createError, "");
  assert.equal(store.getState().activeId, "created");
});

test("an older history failure cannot replace the latest successful reload", async () => {
  store.setState({ active: null, activeId: null });
  let reject!: (error: Error) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests === 1) { started(); return new Promise((_resolve, fail) => { reject = fail; }); }
    return new Response(JSON.stringify([{ id: "latest", title: "Latest history" }]));
  };
  const old = store.getState().loadConversations();
  await entered;
  await store.getState().loadConversations();
  reject(new Error("old failure"));
  await old;
  assert.equal(store.getState().historyError, "");
  assert.equal(store.getState().historyLoading, false);
  assert.equal(store.getState().conversations[0].id, "latest");
});

test("late new-chat creation cannot replace a conversation opened during the request", async () => {
  store.setState({ active: { id: "source", messages: [], draftText: "" }, activeId: "source", createError: "", creatingConversation: false });
  let release!: (response: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_url, init: any = {}) => {
    if (init.method === "POST") { started(); return new Promise(resolve => { release = resolve; }); }
    return new Response(JSON.stringify({ id: "selected", title: "Selected", messages: [], draftText: "" }));
  };
  const creating = store.getState().newConversation();
  await entered;
  assert.equal(await store.getState().openConversation("selected"), true);
  release(new Response(JSON.stringify({ id: "late", messages: [], draftText: "" })));
  assert.equal(await creating, false);
  assert.equal(store.getState().activeId, "selected");
  assert.equal(store.getState().creatingConversation, false);
  assert.equal(store.getState().createError, "");
});

test("opening another conversation dismisses an earlier new-chat failure", async () => {
  store.setState({ active: { id: "before", messages: [], draftText: "" }, activeId: "before", createError: "An earlier creation failed." });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "opened", messages: [], draftText: "" }));
  assert.equal(await store.getState().openConversation("opened"), true);
  assert.equal(store.getState().createError, "");
});

test("failed new-chat creation preserves a running reply and its subscription", async () => {
  const active = { id: "still-running", messages: [{ role: "user", content: "Question" }], draftText: "" };
  let detached = 0;
  const abort = () => { detached++; };
  store.setState({ active, activeId: active.id, creatingConversation: false, createError: "", streaming: true,
    abortStream: abort, streamText: "Partial answer", streamThinking: "", streamTools: [], streamCards: [], streamMemory: [], streamAnalysis: [], streamSearch: null });
  globalThis.fetch = async () => new Response('{}', { status: 500 });
  assert.equal(await store.getState().newConversation(), false);
  assert.equal(detached, 0);
  assert.equal(store.getState().streaming, true);
  assert.equal(store.getState().abortStream, abort);
  assert.equal(store.getState().streamText, "Partial answer");
  assert.deepEqual(store.getState().active.messages, [{ role: "user", content: "Question" }]);
  store.setState({ streaming: false, abortStream: null, streamText: "" });
});

test("branch opens copied history with an empty composer and preserves the original draft and attachments", async () => {
  const source = { id: "branch-source", title: "Original", messages: [{ id: "user-id", role: "user", content: "Question" }, { id: "reply-id", role: "assistant", content: "Answer" }], draftText: "My original unfinished draft" };
  const attachment = { id: "upload", name: "pending.txt" };
  const branch = { ...source, id: "branch-copy", title: "Branch: Original", draftText: "" };
  store.setState({ activeId: source.id, active: source, pendingAttachments: [attachment], conversations: [source], streaming: false, backgroundResponding: false, settingsSaving: false, reconciling: false, branchingMessage: null });
  let payload: any;
  globalThis.fetch = async (url, init: any = {}) => {
    if (String(url).endsWith('/branch')) { payload = JSON.parse(init.body); return new Response(JSON.stringify(branch)); }
    return new Response(JSON.stringify(source));
  };
  assert.equal(await store.getState().branchMessage(1), true);
  assert.deepEqual(payload, { messageIndex: 1, expectedMessageCount: 2, expectedMessageId: "reply-id" });
  assert.equal(store.getState().activeId, branch.id); assert.equal(store.getState().active.draftText, "");
  assert.deepEqual(store.getState().pendingAttachments, []); assert.equal(store.getState().conversations.length, 2);
  await store.getState().openConversation(source.id);
  assert.equal(store.getState().active.draftText, source.draftText); assert.deepEqual(store.getState().pendingAttachments, [attachment]);
});

test("failed branching leaves the source open and a late branch cannot override newer navigation", async () => {
  const source = { id: "branch-failure", messages: [{ role: "user", content: "Question" }], draftText: "" };
  store.setState({ activeId: source.id, active: source, pendingAttachments: [], conversations: [source], streaming: false, backgroundResponding: false, settingsSaving: false, reconciling: false, branchingMessage: null });
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Storage full" }), { status: 500 });
  assert.equal(await store.getState().branchMessage(0), false);
  assert.equal(store.getState().activeId, source.id); assert.match(store.getState().messageError, /Storage full/); assert.equal(store.getState().branchingMessage, null);
  let release!: (response: Response) => void;
  globalThis.fetch = async url => String(url).endsWith('/branch') ? new Promise(resolve => { release = resolve; }) : new Response(JSON.stringify({ id: 'other', messages: [], draftText: '' }));
  const pending = store.getState().branchMessage(0); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(await store.getState().branchMessage(0), false, 'duplicate click is ignored');
  await store.getState().openConversation('other');
  release(new Response(JSON.stringify({ id: 'late-branch', title: 'Branch', messages: source.messages, draftText: '' })));
  assert.equal(await pending, false); assert.equal(store.getState().activeId, 'other');
  assert.ok(store.getState().conversations.some(c => c.id === 'late-branch'));
});

test("privacy events and completion preserve the private conversation marker", async () => {
  for (const type of ['privacy', 'done']) {
    store.setState({ activeId: 'private-chat', active: { id: 'private-chat', messages: [], draftText: '' },
      conversations: [{ id: 'private-chat' }], streaming: false, backgroundResponding: false,
      reconciling: false, settingsSaving: false, branchingMessage: null, pendingAttachments: [] });
    globalThis.fetch = async (_url, init: any = {}) => {
      if (init.method === 'PATCH') return new Response('{}');
      const events = type === 'privacy'
        ? [{ type: 'privacy', privateMemoryUsed: true }, { type: 'done', message: { role: 'assistant', content: 'Saved.' } }]
        : [{ type: 'done', privateMemoryUsed: true, message: { role: 'assistant', content: 'Saved.' } }];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    };
    await store.getState().startStream('Remember this privately');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(store.getState().active.privateMemoryUsed, true);
    assert.equal(store.getState().conversations.find(c => c.id === 'private-chat').privateMemoryUsed, true);
    store.getState().detachStream();
  }
});

test('memory reclassification refreshes privacy without replacing streaming messages or drafts', async () => {
  const messages = [{ role: 'user', content: 'Current optimistic message' }];
  store.setState({ activeId: 'reclassified', active: { id: 'reclassified', messages, draftText: 'Keep this draft' },
    conversations: [{ id: 'reclassified' }], streaming: true, streamText: 'Partial reply' });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'reclassified', privateMemoryUsed: true, messages: [], draftText: '' }));
  await store.getState().refreshPrivacy();
  assert.equal(store.getState().active.privateMemoryUsed, true);
  assert.equal(store.getState().active.messages, messages);
  assert.equal(store.getState().active.draftText, 'Keep this draft');
  assert.equal(store.getState().streamText, 'Partial reply');
  assert.equal(store.getState().streaming, true);
  store.setState({ streaming: false });
});

test('late privacy refresh does not alter another active chat', async () => {
  store.setState({ activeId: 'old-private', active: { id: 'old-private', messages: [] }, conversations: [{ id: 'old-private' }] });
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
  const pending = store.getState().refreshPrivacy();
  store.setState({ activeId: 'new-public', active: { id: 'new-public', messages: [] } });
  release(new Response(JSON.stringify({ id: 'old-private', privateMemoryUsed: true })));
  await pending;
  assert.equal(store.getState().active.privateMemoryUsed, undefined);
  assert.equal(store.getState().conversations[0].privateMemoryUsed, true);
});

test('focus bursts preserve the live bubble and create only one recovery subscription', async (t) => {
  const initial = interruptedChat();
  t.after(() => store.getState().detachStream());
  const requests: string[] = [];
  let release!: (value: Response) => void;
  let resumed!: ReadableStreamDefaultController;
  globalThis.fetch = async url => {
    requests.push(String(url));
    if (String(url).endsWith('/messages')) return initial.response;
    if (String(url).endsWith('/stream')) return new Response(new ReadableStream({ start(c) { resumed = c; } }));
    return new Promise(resolve => { release = resolve; });
  };
  await store.getState().startStream('Question');
  await settleStream();
  const pending = store.getState().resumeConversation();
  void store.getState().resumeConversation();
  assert.equal(store.getState().streaming, true);
  assert.equal(store.getState().streamText, 'Partial answer');
  assert.equal(store.getState().messageError, '');
  release(new Response(JSON.stringify({ responding: true, messages: [
    { role: 'user', content: 'Question' }, { role: 'assistant', content: 'Caught up' },
  ] })));
  await pending;
  await settleStream();
  void store.getState().resumeConversation();
  assert.equal(requests.filter(u => u.endsWith('/stream')).length, 1);
  assert.equal(requests.filter(u => u.endsWith('/messages')).length, 1);
  resumed.close();
});

test('completion between recovery read and subscription replaces the partial reply once', async (t) => {
  interruptedChat();
  t.after(() => store.getState().detachStream());
  const messages = [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Complete' }];
  globalThis.fetch = async url => String(url).endsWith('/stream')
    ? new Response(`data: ${JSON.stringify({ type: 'snapshot', conversation: { responding: false, messages } })}\n\n`)
    : new Response(JSON.stringify({ responding: true, messages: [messages[0], { role: 'assistant', content: 'Partial' }] }));
  await store.getState().recoverConversation('interrupted');
  await settleStream();
  assert.deepEqual(store.getState().active.messages, messages);
  assert.equal(store.getState().streaming, false);
  assert.equal(store.getState().backgroundResponding, false);
  assert.equal(store.getState().messageError, '');
});

test('Stop after reconnect cancels once and late deltas cannot change the saved answer', async (t) => {
  interruptedChat();
  t.after(() => store.getState().detachStream());
  let stopped = false;
  let cancels = 0;
  let resumed!: ReadableStreamDefaultController;
  globalThis.fetch = async url => {
    if (String(url).endsWith('/cancel')) { stopped = true; cancels++; return new Response(null, { status: 204 }); }
    if (String(url).endsWith('/stream')) return new Response(new ReadableStream({ start(c) { resumed = c; } }));
    return new Response(JSON.stringify({ responding: !stopped, messages: [{ role: 'assistant', content: stopped ? 'Stopped' : 'Partial' }] }));
  };
  await store.getState().recoverConversation('interrupted');
  await settleStream();
  await store.getState().stopStream();
  resumed.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"Late"}\n\n'));
  resumed.close();
  await settleStream();
  assert.equal(cancels, 1);
  assert.equal(store.getState().active.messages.at(-1).content, 'Stopped');
  assert.equal(store.getState().streamText, '');
  assert.equal(store.getState().streaming, false);
});

test('foreground recovery restores unsent text and attachments when POST never reached the server', async (t) => {
  interruptedChat();
  t.after(() => store.getState().detachStream());
  const attachment = { id: 'unsent-upload' };
  store.setState({ pendingAttachments: [attachment] });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/messages')) return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    return new Response(JSON.stringify({ messages: [], responding: false }));
  };
  await store.getState().startStream('Do not lose this');
  await store.getState().resumeConversation();
  assert.equal(store.getState().active.draftText, 'Do not lose this');
  assert.deepEqual(store.getState().pendingAttachments, [attachment]);
});

test('only a newly submitted message requests scrolling to the latest', async () => {
  const active={id:'abcdef123456',title:'Scroll test',messages:[],draftText:''};
  store.setState({activeId:active.id,active,streaming:false,backgroundResponding:false,reconciling:false,settingsSaving:false,branchingMessage:null,pendingAttachments:[],conversations:[]});
  globalThis.fetch=async()=>new Response('data: {"type":"done","message":{"role":"assistant","content":"Reply"}}\n\n');
  const before=store.getState().scrollToLatestRequest;
  await store.getState().startStream('New message');
  const request=store.getState().scrollToLatestRequest;
  assert.notEqual(request,before);
  assert.equal(request.conversationId,active.id);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(store.getState().scrollToLatestRequest,request,'completion must not force another scroll');
  await store.getState().startStream('',0);
  assert.equal(store.getState().scrollToLatestRequest,request,'regeneration must preserve reading position');
  await new Promise(resolve=>setTimeout(resolve,0));
});

test('resumed chat preserves a second thinking section after reply text, even in a single event batch', async t => {
  interruptedChat();
  t.after(() => store.getState().detachStream());
  let live!: ReadableStreamDefaultController;
  const first = [{ type: 'thinking', text: 'First reasoning.' }, { type: 'content', text: 'Intermediate reply.' }];
  const running = { id: 'running', title: 'Running', responding: true, messages: [
    { role: 'user', content: 'Question' },
    { role: 'assistant', thinking: first[0].text, content: first[1].text, parts: first },
  ] };
  globalThis.fetch = async url => String(url).endsWith('/stream')
    ? new Response(new ReadableStream({ start(c) { live = c; c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'snapshot', conversation: running })}\n\n`)); } }))
    : new Response(JSON.stringify(running));
  await store.getState().openConversation('running');
  await settleStream();
  live.enqueue(new TextEncoder().encode('data: {"type":"content","delta":" More."}\n\ndata: {"type":"thinking","delta":"Second reasoning."}\n\n'));
  await new Promise(r => setTimeout(r, 80));
  assert.deepEqual(store.getState().streamParts, [first[0], { type: 'content', text: 'Intermediate reply. More.' }, { type: 'thinking', text: 'Second reasoning.' }]);
  live.enqueue(new TextEncoder().encode('data: {"type":"content","delta":"Final reply."}\n\n'));
  await new Promise(r => setTimeout(r, 80));
  assert.equal(store.getState().streamParts.at(-1).type, 'content');
  assert.equal(store.getState().streamParts.length, 4);
  live.close();
});
