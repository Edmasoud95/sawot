import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { runChat } from "../src/chat.js";

for (const mode of ["chat", "voice"] as const) {
  function fixture(options: { toolRounds?: number; final?: "answer" | "tool" | "empty" | "error"; cancel?: boolean; failedSearch?: boolean } = {}) {
    const requests: any[] = [];
    const events: Array<[string, any]> = [];
    const history: any[] = [];
    const controller = new AbortController();
    let searches = 0;
    const tools = [{ name: "web_search", description: "Search", parameters: {}, handler: async () => {
      searches++;
      if (options.cancel && searches === 5) controller.abort();
      return options.failedSearch ? { error: "Search unavailable" }
        : { results: [{ title: `Source ${searches}`, url: `https://example.com/${searches}`, description: `Evidence ${searches}` }] };
    } }];
    const client = { chat: { completions: { create: async (body: any) => {
      requests.push(structuredClone(body));
      const useTool = requests.length <= (options.toolRounds ?? 5) || options.final === "tool";
      if (!useTool && options.final === "error") throw new Error("Provider unavailable");
      const message = useTool
        ? { content: null, tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: "web_search", arguments: '{"query":"question"}' } }] }
        : { content: options.final === "empty" ? "" : "Answer from the collected evidence." };
      if (mode === "voice") return { choices: [{ message }] };
      return (async function* () { yield { choices: [{ delta: message }] }; })();
    } } } };
    const run = async () => {
      if (mode === "voice") return new Agent(client as any, "mock", tools, "System").run(
        history, "Question", (event, data) => { events.push([event, data]); }, { signal: controller.signal },
      );
      let reply = "";
      for await (const [event, data] of runChat(client, "mock", tools, "System", [], undefined, "high", controller.signal)) {
        events.push(event === "debug" ? [data.event, data.data] : [event, data]);
        if (event === "final") reply = data.content;
      }
      return reply;
    };
    return { run, requests, events, history, searches: () => searches };
  }

  test(`${mode}: answers from the fifth tool round with tools disabled`, async () => {
    const f = fixture();
    assert.equal(await f.run(), "Answer from the collected evidence.");
    assert.equal(f.requests.length, 6);
    assert.equal(f.searches(), 5);
    const final = f.requests[5];
    assert.equal(final.tools, undefined);
    assert.equal(final.messages.filter((m: any) => m.role === "tool").length, 5);
    assert.match(final.messages.at(-1).content, /Evidence 5/);
    assert.match(final.messages[0].content, /answer|reply/i);
    assert.equal(f.events.filter(([e]) => e === "tool_budget_exhausted").length, 1);
    assert.equal(f.events.find(([e]) => e === "reply")?.[1].rounds, 6);
    if (mode === "chat") {
      assert.equal(final.reasoning_effort, "high");
      assert.equal(f.events.filter(([e]) => e === "search").at(-1)?.[1].sources.length, 5);
      assert.equal(f.events.filter(([e]) => e === "content").map(([, d]) => d).join(""), "Answer from the collected evidence.");
    } else {
      assert.equal(f.history.at(-1).content, "Answer from the collected evidence.");
      assert.equal(f.history.some((m) => m.role === "system"), false);
    }
  });

  test(`${mode}: an answer before the budget needs no extra request`, async () => {
    const f = fixture({ toolRounds: 4 });
    assert.equal(await f.run(), "Answer from the collected evidence.");
    assert.equal(f.requests.length, 5);
    assert.equal(f.events.some(([e]) => e === "tool_budget_exhausted"), false);
  });

  test(`${mode}: failed tools are also available to the final answer turn`, async () => {
    const f = fixture({ failedSearch: true });
    await f.run();
    assert.equal(f.requests.length, 6);
    assert.match(f.requests[5].messages.at(-1).content, /Search unavailable/);
  });

  test(`${mode}: refuses further tool execution on the answer-only turn`, async () => {
    const f = fixture({ final: "tool" });
    if (mode === "chat") {
      const reply = await f.run();
      assert.match(reply, /couldn’t finish the answer/);
      assert.match(reply, /https:\/\/example\.com\/5/);
      assert.equal(f.events.some(([event]) => event === "source_link_fallback"), true);
    } else {
      await assert.rejects(f.run(), /final answer/i);
    }
    assert.equal(f.searches(), 5);
    assert.equal(f.requests.length, 6);
  });

  test(`${mode}: an empty final answer ${mode === "chat" ? "preserves collected source links" : "is an error"}`, async () => {
    const f = fixture({ final: "empty" });
    if (mode === "chat") {
      const reply = await f.run();
      assert.match(reply, /couldn’t finish the answer/);
      assert.match(reply, /https:\/\/example\.com\/5/);
      assert.equal(f.events.some(([event]) => event === "source_link_fallback"), true);
    } else {
      await assert.rejects(f.run(), /final answer/i);
    }
    assert.equal(f.requests.length, 6);
  });

  for (const final of ["tool", "empty"] as const) {
    test(`${mode}: ${final} final answer without retrieved sources is an error`, async () => {
      const f = fixture({ final, failedSearch: true });
      await assert.rejects(f.run(), /final answer/i);
      assert.equal(f.searches(), 5);
      assert.equal(f.requests.length, 6);
    });
  }

  test(`${mode}: propagates provider errors on the answer-only turn`, async () => {
    const f = fixture({ final: "error" });
    await assert.rejects(f.run(), /Provider unavailable/);
    assert.equal(f.requests.length, 6);
  });

  test(`${mode}: cancellation after the fifth tool prevents the final request`, async () => {
    const f = fixture({ cancel: true });
    await assert.rejects(f.run(), { name: "AbortError" });
    assert.equal(f.requests.length, 5);
  });
}
