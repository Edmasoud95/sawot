import assert from "node:assert/strict";
import test from "node:test";
import { buildSearchTools } from "../src/search.js";
import { executeTool } from "../src/tools.js";

const client = { search: async () => [] };
const lookup = async () => ["93.184.216.34"];

test("find_in_page searches beyond the preview using the already-fetched text", async () => {
  let requests = 0;
  const tools = buildSearchTools(client, { lookup, fetchFn: async () => {
    requests++;
    return new Response(`<title>Manual</title><p>${"Introduction. ".repeat(2000)}</p><p>Before. The TARGET PHRASE is here. After.</p>`, { headers: { "content-type": "text/html" } });
  } });
  const preview = await executeTool(tools, "fetch_page", { url: "https://example.com/manual" });
  assert.equal(preview.text.length, 20000);
  assert.equal(preview.truncated, true);
  assert.doesNotMatch(preview.text, /TARGET/);
  const found = await executeTool(tools, "find_in_page", { url: "https://example.com/manual#section", query: "target phrase" });
  assert.equal(found.error, undefined);
  assert.equal(found.total_matches, 1);
  assert.equal(found.matches.length, 1);
  assert.match(found.matches[0].text, /Before\. The TARGET PHRASE is here\. After\./);
  assert.equal(found.page_truncated, false);
  assert.equal(requests, 1, "find must reuse the longer cached text, ignoring URL fragments");
});

test("literal matching is bounded and reports no matches clearly", async () => {
  const tools = buildSearchTools(client, { lookup, fetchFn: async () => new Response(
    Array.from({ length: 20 }, () => "a+b? " + "padding ".repeat(100)).join("\n"),
    { headers: { "content-type": "text/plain" } },
  ) });
  const found = await executeTool(tools, "find_in_page", { url: "https://example.com/", query: "a+b?", count: 500 });
  assert.equal(found.total_matches, 20);
  assert.equal(found.matches.length, 10);
  assert.equal(found.has_more, true);
  assert.ok(found.matches.every((m: any) => m.text.length <= 700));
  const absent = await executeTool(tools, "find_in_page", { url: "https://example.com/", query: "not present" });
  assert.deepEqual(absent.matches, []);
  assert.equal(absent.total_matches, 0);
  assert.equal(absent.has_more, false);
});

test("find rejects invalid queries and unsafe pages before any fetch", async () => {
  let requests = 0;
  const tools = buildSearchTools(client, { lookup, fetchFn: async () => { requests++; return new Response("no"); } });
  for (const query of ["", "   ", "x".repeat(201), null, 42]) {
    const result = await executeTool(tools, "find_in_page", { url: "https://example.com/", query });
    assert.match(result.error, /query/i);
  }
  const unsafe = await executeTool(tools, "find_in_page", { url: "http://127.0.0.1/", query: "hello" });
  assert.match(unsafe.error, /private|local/);
  assert.equal(requests, 0);
});

test("cached redirected pages are reusable by their final URL and refreshable", async () => {
  let requests = 0;
  const tools = buildSearchTools(client, { lookup, fetchFn: async (url) => {
    requests++;
    if (String(url).endsWith("/old")) return new Response(null, { status: 302, headers: { location: "/new" } });
    return new Response("needle version " + requests, { headers: { "content-type": "text/plain" } });
  } });
  const first = await executeTool(tools, "find_in_page", { url: "https://example.com/old", query: "needle" });
  assert.equal(first.url, "https://example.com/new");
  await executeTool(tools, "find_in_page", { url: "https://example.com/new", query: "needle" });
  assert.equal(requests, 2);
  await executeTool(tools, "fetch_page", { url: "https://example.com/new" });
  const refreshed = await executeTool(tools, "find_in_page", { url: "https://example.com/new", query: "needle" });
  assert.match(refreshed.matches[0].text, /version 3/);
});

test("the page cache expires and evicts old entries", async () => {
  let requests = 0;
  let now = 0;
  const tools = buildSearchTools(client, { lookup, now: () => now, fetchFn: async () => {
    requests++;
    return new Response("needle", { headers: { "content-type": "text/plain" } });
  } });
  const find = (n: number) => executeTool(tools, "find_in_page", { url: `https://example.com/${n}`, query: "needle" });
  await find(0);
  await find(0);
  assert.equal(requests, 1);
  now = 6 * 60 * 1000;
  await find(0);
  assert.equal(requests, 2, "expired entries must be fetched again");
  for (let n = 1; n <= 12; n++) await find(n);
  const before = requests;
  await find(0);
  assert.equal(requests, before + 1, "old entries must not grow the cache indefinitely");
});

test("a download limit is reported even when no matching text was captured", async () => {
  const tools = buildSearchTools(client, { lookup, fetchFn: async () => new Response(
    "x".repeat(2 * 1024 * 1024 + 10) + "needle", { headers: { "content-type": "text/plain" } },
  ) });
  const found = await executeTool(tools, "find_in_page", { url: "https://example.com/huge", query: "needle" });
  assert.deepEqual(found.matches, []);
  assert.equal(found.page_truncated, true, "no match in a partial page must not imply absence from the whole page");
});
