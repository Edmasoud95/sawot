import assert from "node:assert/strict";
import test from "node:test";
import { runChat } from "../src/chat.js";
import { ChatStore } from "../src/chat.js";
import { registerChatRoutes } from "../src/chatRoutes.js";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raw = '<tool_call>\n<function=web_search>\n<parameter=query>life expectancy</parameter>\n</function>\n</tool_call>';

function fixture(responses: any[][], abortOnRepair = false) {
  const requests: any[] = [], events: any[] = [];
  const controller = new AbortController();
  let executed = 0;
  const client = { chat: { completions: { create: async (body: any) => {
    requests.push(structuredClone(body));
    assert.ok(requests.length <= responses.length, "recovery must be bounded");
    if (abortOnRepair && requests.length === 2) controller.abort();
    const deltas = responses[requests.length - 1];
    return (async function* () { for (const delta of deltas) yield { choices: [{ delta }] }; })();
  } } } };
  const run = async () => {
    for await (const event of runChat(client, "mock", [{ name: "web_search", description: "", parameters: {},
      handler: async () => { executed++; return { results: [{ url: "https://example.org", title: "Evidence" }] }; },
    }], "System", [], undefined, null, controller.signal)) events.push(event);
  };
  return { run, requests, events, executed: () => executed,
    visible: () => events.filter(e => e[0] === "content").map(e => e[1]).join("") };
}
const chunks = (text: string) => [...text].map(content => ({ content }));
const call = (id: string) => [{ tool_calls: [{ index: 0, id, function: { name: "web_search", arguments: '{}' } }] }];

test("raw markup after the tool budget gets one answer-only repair without repeating tools", async () => {
  const f = fixture([...Array.from({ length: 5 }, (_, i) => call(String(i))), chunks(raw), chunks("I could not retrieve the table.")]);
  await f.run();
  assert.equal(f.executed(), 5);
  assert.equal(f.requests.length, 7);
  assert.equal(f.requests[6].tools, undefined);
  assert.equal(f.requests[6].messages.filter((m: any) => m.role === "tool").length, 5);
  assert.equal(f.visible(), "I could not retrieve the table.");
  assert.equal(f.events.find(e => e[0] === "final")[1].content, f.visible());
});

test("malformed call before budget can recover through structured tools", async () => {
  const f = fixture([chunks(raw), call("fixed"), chunks("The answer.")]);
  await f.run();
  assert.equal(f.executed(), 1);
  assert.ok(f.requests[1].tools);
  assert.equal(f.visible(), "The answer.");
});

test("repeated malformed calls fail clearly without leaking or executing markup", async () => {
  const f = fixture([chunks(raw), chunks(raw)]);
  await assert.rejects(f.run(), /tool.call|tool request/i);
  assert.equal(f.visible(), "");
  assert.equal(f.executed(), 0);
  assert.equal(f.events.some(e => e[0] === "final"), false);
});

test("ordinary streamed prose and quoted code examples survive unchanged", async () => {
  const text = 'Use `<tool_call>` in examples.\n```xml\n' + raw + '\n```\nDone.';
  const f = fixture([chunks(text)]);
  await f.run();
  assert.equal(f.visible(), text);
  assert.equal(f.requests.length, 1);
});

test("markup after prose is suppressed even when a tag spans chunks", async () => {
  const f = fixture([chunks("Let me check.\n" + raw), chunks("Unable to search.")]);
  await f.run();
  assert.equal(f.visible(), "Let me check.\nUnable to search.");
});

test("reasoning markup is not mistaken for an executable call", async () => {
  const f = fixture([[{ reasoning_content: raw }, ...chunks("Answer.")]]);
  await f.run();
  assert.equal(f.visible(), "Answer.");
  assert.equal(f.requests.length, 1);
});

for (const prefix of ['Use \\` literally.\n', 'Text ~~~ decoration.\n', '```xml\nexample\n````\n', '~~~xml\nexample\n~~~~\n']) {
  test(`markup following Markdown punctuation is still rejected: ${JSON.stringify(prefix)}`, async () => {
    const f = fixture([chunks(prefix + raw), chunks("Answer.")]);
    await f.run();
    assert.equal(f.visible(), prefix + "Answer.");
  });
}

test("cancellation stops recovery", async () => {
  const f = fixture([chunks(raw), chunks("Answer.")], true);
  await assert.rejects(f.run(), { name: "AbortError" });
  assert.equal(f.visible(), "");
});

for (const markup of ['[TOOL_REQUEST]{"name":"web_search"}[END_TOOL_REQUEST]', '<function=web_search>', '<tool_ca']) {
  test(`suppresses alternate or incomplete protocol markup: ${markup}`, async () => {
    const f = fixture([chunks(markup), chunks("Answer.")]);
    await f.run();
    assert.equal(f.visible(), "Answer.");
  });
}

test("structured calls accompanying raw markup execute once without replay", async () => {
  const f = fixture([[...chunks(raw), ...call("valid")], chunks("Answer.")]);
  await f.run();
  assert.equal(f.executed(), 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.visible(), "Answer.");
});

test("recovery cannot execute a structured call after exhausting the budget", async () => {
  const f = fixture([...Array.from({ length: 5 }, (_, i) => call(String(i))), chunks(raw), call("forbidden")]);
  await f.run();
  assert.equal(f.executed(), 5);
  assert.match(f.visible(), /https:\/\/example.org/);
  assert.doesNotMatch(f.visible(), /<tool_call>|<function=/);
  assert.equal(f.requests.length, 7);
});

test("ordinary text streams before the provider finishes", async () => {
  let emitted = false;
  const client = { chat: { completions: { create: async () => (async function* () {
    yield { choices: [{ delta: { content: "First sentence." } }] };
    assert.equal(emitted, true);
    yield { choices: [{ delta: { content: " Second sentence." } }] };
  })() } } };
  for await (const [event] of runChat(client, "mock", [], "System", [])) if (event === "content") emitted = true;
});

for (const recover of [true, false]) {
  test(`chat route ${recover ? "saves recovered text" : "persists an error"} without leaking markup`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-markup-"));
    const app = Fastify(), store = new ChatStore(dir);
    let attempt = 0;
    const client = { chat: { completions: { create: async () => {
      const content = ++attempt === 2 && recover ? "Recovered answer." : raw;
      return (async function* () { for (const delta of chunks(content)) yield { choices: [{ delta }] }; })();
    } } } };
    registerChatRoutes(app, { store, uploadDir: dir, resolve: () => ({ client, model: "mock" }),
      ha: null, haTools: [], searchTools: [], name: "Test", getEntitySummary: () => "",
      getChatInstructions: () => "", getDefaultModel: () => "mock" });
    try {
      const conversation = store.create("mock");
      conversation.title = "Existing title";
      store.save(conversation);
      const response = await app.inject({ method: "POST", url: `/api/chat/conversations/${conversation.id}/messages`, payload: { content: "Find information" } });
      const saved = store.get(conversation.id);
      assert.doesNotMatch(response.body, /<tool_call>|<function=/);
      assert.equal(saved.messages.at(-1).content, recover ? "Recovered answer." : "");
      if (recover) assert.match(response.body, /"type":"done"/);
      else {
        assert.match(response.body, /"type":"error"/);
        assert.match(saved.responseError, /invalid tool call/);
      }
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}
