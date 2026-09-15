import assert from "node:assert/strict";
import test from "node:test";
import { Agent } from "../src/agent.js";
import { buildSearchTools } from "../src/search.js";
import { runVoiceTurn } from "../src/pipeline.js";

for (const fails of [false, true]) {
  test(`voice search reaches speech (failure=${fails})`, async () => {
    const requests: any[] = [];
    const queries: string[] = [];
    const spoken: string[] = [];
    const answer = fails ? "The search failed." : "According to Example, the event is today.";
    const client = { chat: { completions: { create: async (request: any) => {
      requests.push(structuredClone(request));
      return { choices: [{ message: requests.length === 1
        ? { content: null, tool_calls: [{ id: "search1", type: "function", function: { name: "web_search", arguments: '{"query":"latest event"}' } }] }
        : { content: answer } }] };
    } } } };
    const tools = buildSearchTools({ search: async (query) => {
      queries.push(query);
      if (fails) throw new Error("search offline");
      return [{ title: "Example", url: "https://example.com/event", description: "The event is today." }];
    } });
    const agent = new Agent(client as never, "test", tools, "Speak briefly.");
    agent.setSystemPrompt("Updated personality.");
    await runVoiceTurn({
      transcribe: async () => "Look up the latest event",
      synthesize: async (text: string) => { spoken.push(text); return Buffer.from("wav"); },
    } as never, agent, Buffer.from("audio"), [], () => {}, "voice");
    assert.deepEqual(queries, ["latest event"]);
    assert.deepEqual(spoken, [answer]);
    assert.match(requests[0].messages[0].content, /Updated personality\.[\s\S]*web_search[\s\S]*fetch_page/);
    assert.match(requests[0].messages[0].content, /naming the source naturally/);
    assert.ok(requests[0].tools.some((t: any) => t.function.name === "fetch_page"));
    const result = JSON.parse(requests[1].messages.find((m: any) => m.role === "tool").content);
    assert.equal(Boolean(result.error), fails);
    if (!fails) assert.equal(result.results[0].title, "Example");
  });
}

test("voice without configured search does not advertise web access", async () => {
  let request: any;
  const client = { chat: { completions: { create: async (r: any) => {
    request = r;
    return { choices: [{ message: { content: "Hello." } }] };
  } } } };
  await new Agent(client as never, "test", [], "Voice assistant.").run([], "Hi");
  assert.doesNotMatch(request.messages[0].content, /web_search|fetch_page/);
});

for (const outcome of ["results", "empty", "error"] as const) {
  test(`voice publishes compact search activity and actual sources: ${outcome}`, async () => {
    let round = 0;
    const events: { type: string; data: any }[] = [];
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: round++ < 2
      ? { content: null, tool_calls: [{ id: String(round), type: "function", function: round === 1
        ? { name: "web_search", arguments: '{"query":"news"}' }
        : { name: "fetch_page", arguments: '{"url":"https://example.com/article"}' } }] }
      : { content: "Here is the news." } }] }) } } };
    const tools = buildSearchTools({ search: async () => {
      if (outcome === "error") throw new Error("private diagnostic detail");
      if (outcome === "empty") return [];
      return [
        { title: "First article", url: "https://example.com/article", description: "Long snippet ".repeat(200) },
        { title: "Second article", url: "https://other.example/news", description: "Another snippet" },
        { title: "Unsafe", url: "javascript:alert(1)", description: "" },
        { title: "Credentials", url: "https://user:secret@example.com/", description: "" },
      ];
    } }, {
      lookup: async () => ["93.184.216.34"],
      fetchFn: async () => outcome === "error"
        ? new Response("Failure", { status: 503 })
        : new Response("<title>Read article</title><p>Full page content</p>", { headers: { "content-type": "text/html" } }),
    });
    await runVoiceTurn({
      transcribe: async () => "Find the news",
      synthesize: async () => Buffer.from("wav"),
    } as never, new Agent(client as never, "test", tools, "Voice assistant"), Buffer.from("audio"), [],
    (type, data) => { events.push({ type, data }); }, "voice");
    const search = events.filter(e => e.type === "search").map(e => e.data);
    assert.equal(search.length, 4, "each web operation must report start and completion");
    assert.equal(search[0].phase, "start");
    assert.equal(search[0].tool, "web_search");
    assert.equal(search[1].phase, outcome === "error" ? "error" : "complete");
    assert.deepEqual(search[1].sources, outcome === "results" ? [
      { title: "First article", url: "https://example.com/article", read: false },
      { title: "Second article", url: "https://other.example/news", read: false },
    ] : []);
    assert.equal(search[2].tool, "fetch_page");
    assert.equal(search[3].phase, outcome === "error" ? "error" : "complete");
    assert.deepEqual(search[3].sources, outcome === "error" ? [] : [
      { title: "Read article", url: "https://example.com/article", read: true },
    ]);
    assert.doesNotMatch(JSON.stringify(search), /snippet|Full page content|private diagnostic|secret/);
    assert.ok(events.findIndex(e => e.type === "search") < events.findIndex(e => e.type === "assistant_text"));
  });
}

test("voice find_in_page shows source activity and supplies matched text before speech", async () => {
  let round = 0;
  const events: any[] = [];
  const requests: any[] = [];
  const client = { chat: { completions: { create: async (request: any) => {
    requests.push(structuredClone(request));
    return { choices: [{ message: round++ === 0
      ? { content: null, tool_calls: [{ id: "find", type: "function", function: { name: "find_in_page", arguments: '{"url":"https://example.com/manual","query":"warranty"}' } }] }
      : { content: "The warranty is two years." } }] };
  } } } };
  const tools = buildSearchTools({ search: async () => [] }, {
    lookup: async () => ["93.184.216.34"], fetchFn: async () => new Response("The warranty is two years.", { headers: { "content-type": "text/plain" } }),
  });
  await runVoiceTurn({ transcribe: async () => "Find the warranty", synthesize: async () => Buffer.from("wav") } as never,
    new Agent(client as never, "test", tools, "Voice assistant"), Buffer.from("audio"), [], (type, data) => { events.push({ type, ...data }); }, "voice");
  assert.match(requests[0].messages[0].content, /find_in_page/);
  assert.match(JSON.parse(requests[1].messages.find((m: any) => m.role === "tool").content).matches[0].text, /two years/);
  const search = events.filter(e => e.type === "search");
  assert.equal(search.length, 2);
  assert.equal(search[0].tool, "find_in_page");
  assert.equal(search[0].phase, "start");
  assert.equal(search[1].sources[0].read, true);
  assert.ok(events.findIndex(e => e.type === "search") < events.findIndex(e => e.type === "wav"));
});
