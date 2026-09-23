import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({ entryPoints: [new URL("../src/chatStore.ts", import.meta.url).pathname], bundle: true, write: false, platform: "node", format: "esm", define: { "import.meta.env": "{}" } });
Object.assign(globalThis, { window: { matchMedia: () => ({ matches: true }) }, location: { protocol: "http:", host: "localhost" }, localStorage: { getItem: () => null } });
const { useChatStore: store } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=chatStore-test.mjs").toString("base64")}`);

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

test("new chats stay hidden; drafts restore per chat and disappear below three words", async () => {
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
  assert.equal(records.get(first).draftText, "");
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
