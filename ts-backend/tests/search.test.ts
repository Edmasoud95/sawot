import assert from "node:assert/strict";
import test from "node:test";
import { BraveSearchClient, buildSearchTools } from "../src/search.js";
import { executeTool } from "../src/tools.js";

function fakeFetch(status: number, body: unknown, capture: any[] = []): typeof fetch {
  return (async (url: any, init: any) => {
    capture.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("BraveSearchClient maps web results and sends the key as a header", async () => {
  const calls: any[] = [];
  const client = new BraveSearchClient("brv-1", fakeFetch(200, {
    web: { results: [
      { title: "A", url: "https://a.example/", description: "first" },
      { title: "B", url: "https://b.example/", description: "second", extra: true },
    ] },
  }, calls));
  const results = await client.search("hello world", 2);
  assert.deepEqual(results, [
    { title: "A", url: "https://a.example/", description: "first" },
    { title: "B", url: "https://b.example/", description: "second" },
  ]);
  assert.match(calls[0].url, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.match(calls[0].url, /q=hello\+world|q=hello%20world/);
  assert.match(calls[0].url, /count=2/);
  assert.equal(calls[0].init.headers["X-Subscription-Token"], "brv-1");
});

test("a Brave error becomes an error result without the key", async () => {
  const tools = buildSearchTools(new BraveSearchClient("brv-secret", fakeFetch(429, { message: "rate" })));
  const result = await executeTool(tools, "web_search", { query: "x" });
  assert.match(result.error, /429/);
  assert.doesNotMatch(JSON.stringify(result), /brv-secret/);
});

test("web_search clamps count and returns results", async () => {
  const calls: any[] = [];
  const client = new BraveSearchClient("k", fakeFetch(200, { web: { results: [{ title: "T", url: "https://t.example/", description: "d" }] } }, calls));
  const tools = buildSearchTools(client);
  const tool = tools.find((t) => t.name === "web_search")!;
  assert.deepEqual(tool.parameters.required, ["query"]);
  const result = await executeTool(tools, "web_search", { query: "q", count: 50 });
  assert.match(calls[0].url, /count=8/);
  assert.deepEqual(result, { results: [{ title: "T", url: "https://t.example/", description: "d" }] });
  await executeTool(tools, "web_search", { query: "q" });
  assert.match(calls[1].url, /count=5/, "default count");
  assert.equal(tool.touchedIds, undefined, "search never produces device cards");
});
