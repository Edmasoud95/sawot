import assert from "node:assert/strict";
import test from "node:test";
import { BraveSearchClient, buildSearchTools, htmlToText, isPrivateAddress } from "../src/search.js";
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

test("private, loopback and link-local addresses are recognised", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.1.1", "::1", "fc00::1", "fd12::3", "fe80::1", "::ffff:192.168.0.1", "0.0.0.0"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("htmlToText keeps paragraph text and drops scripts, styles and tags", () => {
  const { title, text } = htmlToText(
    "<html><head><title>My &amp; Page</title><style>p{color:red}</style></head>" +
    "<body><script>alert(1)</script><h1>Hello</h1><p>One &lt;two&gt;</p><div>Three<br>Four</div><svg><path d=\"M0\"/></svg></body></html>",
  );
  assert.equal(title, "My & Page");
  assert.equal(text, "Hello\nOne <two>\nThree\nFour");
});

const publicLookup = async () => ["93.184.216.34"];
const privateLookup = async () => ["192.168.1.10"];
const noClient = { search: async () => [] };

test("fetch_page refuses unsafe URLs before fetching", async () => {
  let fetched = 0;
  const fetchFn = (async () => { fetched++; return new Response("x"); }) as typeof fetch;
  const tools = buildSearchTools(noClient, { fetchFn, lookup: privateLookup });
  for (const url of ["file:///etc/passwd", "ftp://example.com/", "http://127.0.0.1:8123/", "http://homeassistant.local:8123/", "http://[::1]/", "not a url"]) {
    const result = await executeTool(tools, "fetch_page", { url });
    assert.ok(result.error, url);
  }
  assert.equal(fetched, 0, "nothing was fetched");
});

test("fetch_page returns page text with a title and a truncation flag", async () => {
  const long = "<p>" + "word ".repeat(6000) + "</p>";
  const fetchFn = (async (url: any) => new Response(
    String(url).includes("long") ? "<title>Long</title>" + long : "<title>Short</title><p>Hi there</p>",
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  )) as typeof fetch;
  const tools = buildSearchTools(noClient, { fetchFn, lookup: publicLookup });
  const short = await executeTool(tools, "fetch_page", { url: "https://example.com/short" });
  assert.deepEqual(short, { url: "https://example.com/short", title: "Short", text: "Hi there", truncated: false });
  const longResult = await executeTool(tools, "fetch_page", { url: "https://example.com/long" });
  assert.equal(longResult.truncated, true);
  assert.equal(longResult.text.length, 20_000);
});

test("fetch_page rejects non-text content and follows only safe redirects", async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: any) => {
    seen.push(String(url));
    if (String(url).endsWith("/pdf")) return new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } });
    if (String(url).endsWith("/hop")) return new Response(null, { status: 302, headers: { location: "http://192.168.1.10/" } });
    return new Response("<p>ok</p>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const lookup = async (host: string) => (host === "192.168.1.10" ? ["192.168.1.10"] : ["93.184.216.34"]);
  const tools = buildSearchTools(noClient, { fetchFn, lookup });
  const pdf = await executeTool(tools, "fetch_page", { url: "https://example.com/pdf" });
  assert.match(pdf.error, /content type/i);
  const hop = await executeTool(tools, "fetch_page", { url: "https://example.com/hop" });
  assert.match(hop.error, /private|local/i);
  assert.ok(!seen.includes("http://192.168.1.10/"), "the private redirect target was never fetched");
});

test("Brave retries a short rate limit and returns the subsequent results", async () => {
  const attempts: number[] = [];
  const client = new BraveSearchClient("key", async () => {
    attempts.push(performance.now());
    if (attempts.length === 1) return new Response(null, { status: 429, headers: {
      "X-RateLimit-Remaining": "0, 1200", "X-RateLimit-Reset": "1, 90000",
    } });
    return new Response(JSON.stringify({ web: { results: [{ title: "Recovered", url: "https://example.com/", description: "Found" }] } }));
  });
  const result = await client.search("news", 1);
  assert.equal(result[0].title, "Recovered");
  assert.equal(attempts.length, 2);
  assert.ok(attempts[1] - attempts[0] >= 950, "wait for the one-second limit to reset");
});

test("Brave bounds retries and does not retry authentication or long quota failures", async () => {
  for (const [status, headers, expected] of [
    [429, {}, 3],
    [401, {}, 1],
    [429, { "Retry-After": "3600" }, 1],
    [429, { "X-RateLimit-Remaining": "0, 0", "X-RateLimit-Reset": "1, 90000" }, 1],
  ] as const) {
    let calls = 0;
    const client = new BraveSearchClient("secret", async () => {
      calls++;
      return new Response(null, { status, headers });
    });
    await assert.rejects(client.search("news", 1), new RegExp(`HTTP ${status}`));
    assert.equal(calls, expected);
  }
});

test("Brave keeps trusted favicon URLs for source metadata and rejects other origins", async () => {
  const favicon = "https://imgs.search.brave.com/test-icon";
  const client = new BraveSearchClient("key", fakeFetch(200, { web: { results: [
    { title: "A", url: "https://example.com/a", profile: { img: favicon } },
    { title: "B", url: "https://example.com/b", profile: { img: "http://127.0.0.1/icon" } },
  ] } }));
  const results = await client.search("news", 2);
  const { voiceSearchSources } = await import("../src/search.js");
  const sources = voiceSearchSources("web_search", { results });
  assert.equal(sources[0].favicon, favicon);
  assert.equal(sources[1].favicon, undefined);
});
