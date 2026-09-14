# General Chat Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Chat mode into a general-purpose AI assistant with its own prompt and instructions, a per-conversation Home Assistant toggle, and Brave web search plus a page-read tool.

**Architecture:** The chat route stops reusing the voice system prompt. A new `chatPrompt.ts` builds a general-assistant prompt that appends the device block only when the conversation's `homeAssistant` flag is on. A new `search.ts` provides `web_search` and `fetch_page` tools in the existing `Tool` shape, enabled by a Brave API key in config. The chat route assembles prompt and tools per request. Settings gain a `chatInstructions` string; the web app gains a header toggle and a settings row.

**Tech Stack:** TypeScript, Fastify 5, Node 22 built-in `fetch` and `node:test`, React 19, Zustand, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-09-14-general-chat-mode-design.md`

## Global Constraints

- Voice mode behaviour and its system prompt do not change (only an export is added to `agent.ts`).
- The Brave key is a secret: never logged, never returned by a route, never placed in example files with a real value.
- `fetch_page` must refuse `file:`, loopback, link-local, and private addresses, checking the resolved address, not just the hostname text.
- `chatInstructions` is a string of at most 2000 characters, trimmed on save.
- Conversation files without `homeAssistant` read as `false`.
- Tests run with `node --import tsx tests/<name>.test.ts` from `ts-backend/`. Run `npm run typecheck` in `ts-backend/` and `web/` after code changes in each.
- Do not commit files from the pre-existing uncommitted working tree (custom personality and voice cloning work). `git add` only the paths each task names.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Vn9wod4ZuDzpodhr19EzVE
  ```

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `ts-backend/src/config.ts` (modify) | Read `search.brave_api_key` / `BRAVE_API_KEY` into `Config.braveApiKey`. |
| `ts-backend/src/agent.ts` (modify) | Export `deviceBlock(summary)` so the chat prompt shares the device text. |
| `ts-backend/src/chatPrompt.ts` (create) | `buildChatSystemPrompt(options)`, the chat-only system prompt. |
| `ts-backend/src/search.ts` (create) | `BraveSearchClient`, `isPrivateAddress`, `htmlToText`, `buildSearchTools`. |
| `ts-backend/src/chat.ts` (modify) | `ChatStore.create` takes `homeAssistant`; listing includes it; `runChat` omits an empty `tools` field. |
| `ts-backend/src/chatRoutes.ts` (modify) | New `ChatCtx` shape; per-request prompt and tool assembly; `homeAssistant` on create and patch. |
| `ts-backend/src/settings.ts` (modify) | `chatInstructions` in state, payload, validation, persistence. |
| `ts-backend/src/index.ts` (modify) | Wire search tools, chat context, and `chatInstructions` state. |
| `web/src/chatStore.ts` (modify) | `setHomeAssistant(on)` action. |
| `web/src/components/chat/ChatHeader.tsx` (modify) | Home Assistant toggle button. |
| `web/src/components/settings/AssistantSection.tsx` (modify) | "Chat instructions" disclosure row. |
| `config.example.yaml`, `.env.example`, `README.md`, `AGENTS.md`, `.github/workflows/ci.yml` (modify) | Document the key and the new chat mode; run the new tests in CI. |
| `ts-backend/tests/config.test.ts` (modify), `chatPrompt.test.ts`, `search.test.ts`, `chatRoutes.test.ts` (create), `personality.test.ts` (modify) | Tests. |

---

### Task 1: Brave API key in configuration

**Files:**
- Modify: `ts-backend/src/config.ts`
- Modify: `config.example.yaml`
- Modify: `.env.example`
- Test: `ts-backend/tests/config.test.ts`

**Interfaces:**
- Produces: `Config.braveApiKey: string` (empty string when unset).

- [ ] **Step 1: Write the failing test**

Append to `ts-backend/tests/config.test.ts`:

```ts
test("the Brave key comes from yaml or the environment and defaults to empty", () => {
  const none = loadConfig(tmpConfig(), { HA_TOKEN: "t" });
  assert.equal(none.braveApiKey, "");
  const fromEnv = loadConfig(tmpConfig(), { HA_TOKEN: "t", BRAVE_API_KEY: "brv-1" });
  assert.equal(fromEnv.braveApiKey, "brv-1");
  const dir = mkdtempSync(join(tmpdir(), "sawot-cfg-"));
  const path = join(dir, "config.yaml");
  writeFileSync(path, yaml + "search:\n  brave_api_key: \"brv-yaml\"\n");
  assert.equal(loadConfig(path, { HA_TOKEN: "t" }).braveApiKey, "brv-yaml");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `ts-backend/`: `node --import tsx tests/config.test.ts`
Expected: the new test fails with `undefined !== ''` (the property does not exist yet).

- [ ] **Step 3: Add the config key**

In `ts-backend/src/config.ts`:

Add to the `Config` interface after `assistantPersonalityPrompt: string;`:

```ts
  /** Brave Search API key; empty disables the chat web search tools. */
  braveApiKey: string;
```

Add to `ENV_KEYS` after the `ASSISTANT_PERSONALITY_PROMPT` line:

```ts
  BRAVE_API_KEY: ["search", "brave_api_key"],
```

Add to `DEFAULTS` after `"assistant.personality_prompt": "",`:

```ts
  "search.brave_api_key": "",
```

Add to the returned object after `assistantPersonalityPrompt: ...,`:

```ts
    braveApiKey: String(get("search", "brave_api_key") ?? "").trim(),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx tests/config.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Document the key in the example files**

In `config.example.yaml`, after the `assistant:` block and before `server:`, add:

```yaml
search:
  # brave_api_key: "BSA..."          # Brave Search API key; enables web search in Chat
```

In `.env.example`, append:

```
# Brave Search API key; enables the web search and page-read tools in Chat.
#BRAVE_API_KEY=BSA...
```

- [ ] **Step 6: Typecheck and commit**

Run from `ts-backend/`: `npm run typecheck`
Expected: no errors.

```bash
git add ts-backend/src/config.ts ts-backend/tests/config.test.ts config.example.yaml .env.example
git commit -m "Read a Brave Search API key from config or the environment"
```

---

### Task 2: Chat system prompt builder

**Files:**
- Modify: `ts-backend/src/agent.ts` (the `FUNCTIONAL` constant and `buildSystemPrompt`)
- Create: `ts-backend/src/chatPrompt.ts`
- Test: `ts-backend/tests/chatPrompt.test.ts`

**Interfaces:**
- Produces from `agent.ts`: `export function deviceBlock(entitySummary: string): string` (the existing FUNCTIONAL text with the summary filled in).
- Produces from `chatPrompt.ts`:
  ```ts
  export interface ChatPromptOptions {
    name: string; instructions: string; today: string;
    homeAssistant: boolean; entitySummary: string; search: boolean;
  }
  export function buildChatSystemPrompt(o: ChatPromptOptions): string;
  export function todayLabel(date?: Date): string;   // "Monday 14 September 2026"
  ```

- [ ] **Step 1: Write the failing tests**

Create `ts-backend/tests/chatPrompt.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildChatSystemPrompt, todayLabel } from "../src/chatPrompt.js";
import { buildSystemPrompt } from "../src/agent.js";

const base = { name: "Rita", instructions: "", today: "Monday 14 September 2026", homeAssistant: false, entitySummary: "(devices)", search: false };

test("a plain chat prompt is a general assistant with no devices, search, or voice rules", () => {
  const p = buildChatSystemPrompt(base);
  assert.match(p, /You are Rita, a general-purpose AI assistant/);
  assert.match(p, /Monday 14 September 2026/);
  assert.match(p, /markdown/i);
  assert.doesNotMatch(p, /Devices:/);
  assert.doesNotMatch(p, /web_search/);
  assert.doesNotMatch(p, /Instructions from the user/);
  assert.doesNotMatch(p, /speaking with the user out loud/);
  assert.doesNotMatch(p, /one or two sentences/);
});

test("user instructions are included only when non-empty", () => {
  assert.doesNotMatch(buildChatSystemPrompt({ ...base, instructions: "   " }), /Instructions from the user/);
  const p = buildChatSystemPrompt({ ...base, instructions: "Call me Ed. Prefer Python." });
  assert.match(p, /Instructions from the user:\nCall me Ed\. Prefer Python\./);
});

test("search guidance appears when the search tools exist", () => {
  const p = buildChatSystemPrompt({ ...base, search: true });
  assert.match(p, /web_search/);
  assert.match(p, /fetch_page/);
  assert.match(p, /never invent URLs/i);
});

test("the Home Assistant block reuses the voice prompt's device text", () => {
  const p = buildChatSystemPrompt({ ...base, homeAssistant: true });
  assert.match(p, /You control Home Assistant devices with the provided tools/);
  assert.match(p, /Devices:\n\(devices\)/);
  assert.doesNotMatch(p, /You may also answer general questions conversationally/);
  // The voice prompt still carries the sentence and the same device text.
  const voice = buildSystemPrompt("(devices)", "plain", "Rita");
  assert.match(voice, /You may also answer general questions conversationally/);
  assert.match(voice, /Devices:\n\(devices\)/);
});

test("todayLabel formats a readable date", () => {
  assert.equal(todayLabel(new Date(2026, 8, 14, 12)), "Monday 14 September 2026");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx tests/chatPrompt.test.ts`
Expected: fails at import, `Cannot find module '../src/chatPrompt.js'`.

- [ ] **Step 3: Export the device block from agent.ts**

In `ts-backend/src/agent.ts`, replace the `FUNCTIONAL` constant with a split version and an exported helper. Replace:

```ts
const FUNCTIONAL =
  "\n\nYou control Home Assistant devices with the provided tools. Use the device " +
  ...
  "say so plainly. You may also answer general questions conversationally." +
  "\n\nDevices:\n{summary}";
```

with:

```ts
const DEVICE_RULES =
  "\n\nYou control Home Assistant devices with the provided tools. Use the device " +
  "list below to pick entity_ids directly when acting. The list's states are a " +
  "snapshot and may be stale — when the user asks about a device's current " +
  "state, check it live with get_entities instead of answering from the list. " +
  "The list contains only controllable devices — readings such as temperature, " +
  "humidity or power are NOT listed; fetch those with " +
  "get_entities(domain='sensor', area=...), and pick the matching sensor from " +
  "the result. After acting, confirm briefly what you did. If something fails, " +
  "say so plainly.";

const FUNCTIONAL =
  DEVICE_RULES + " You may also answer general questions conversationally." +
  "\n\nDevices:\n{summary}";

/** The device rules and list, shared with the chat prompt (which supplies its
 *  own wording about answering general questions). */
export function deviceBlock(entitySummary: string): string {
  return DEVICE_RULES + "\n\nDevices:\n" + entitySummary;
}
```

Keep the rest of `buildSystemPrompt` as it is; it still uses `FUNCTIONAL`.

- [ ] **Step 4: Create chatPrompt.ts**

```ts
import { deviceBlock } from "./agent.js";

export interface ChatPromptOptions {
  /** Assistant name from config. */
  name: string;
  /** The user's chat instructions; blank means a neutral assistant. */
  instructions: string;
  /** Readable date, see todayLabel(). */
  today: string;
  /** The conversation's Home Assistant flag. */
  homeAssistant: boolean;
  /** Device list, used only when homeAssistant is true. */
  entitySummary: string;
  /** Whether web_search and fetch_page are offered. */
  search: boolean;
}

export function todayLabel(date = new Date()): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const IDENTITY =
  "You are {name}, a general-purpose AI assistant in a chat app. Answer as fully " +
  "as the question needs: a quick question gets a short answer, a complex one a " +
  "complete explanation. Use markdown where it helps — headings for long " +
  "answers, lists, tables, and fenced code blocks with a language tag. Be " +
  "direct and accurate; say so when you are unsure. Today is {today}.";

const SEARCH =
  "\n\nYou have web tools. Use web_search for current events, facts that may " +
  "have changed since your training, and anything the user asks you to look " +
  "up. Use fetch_page to read a result when its snippet is not enough. Cite " +
  "sources as markdown links in your answer and never invent URLs.";

export function buildChatSystemPrompt(o: ChatPromptOptions): string {
  let prompt = IDENTITY.replace("{name}", o.name).replace("{today}", o.today);
  const instructions = o.instructions.trim();
  if (instructions) prompt += "\n\nInstructions from the user:\n" + instructions;
  if (o.search) prompt += SEARCH;
  if (o.homeAssistant) prompt += deviceBlock(o.entitySummary);
  return prompt;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx tests/chatPrompt.test.ts && node --import tsx tests/personality.test.ts`
Expected: all pass. The personality test's `Devices:\n\(devices\)` assertion confirms the voice prompt is unchanged.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add ts-backend/src/agent.ts ts-backend/src/chatPrompt.ts ts-backend/tests/chatPrompt.test.ts
git commit -m "Add a general-assistant system prompt for chat"
```

---

### Task 3: Brave search client and web_search tool

**Files:**
- Create: `ts-backend/src/search.ts`
- Test: `ts-backend/tests/search.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SearchResult { title: string; url: string; description: string }
  export interface SearchClient { search(query: string, count: number): Promise<SearchResult[]> }
  export class BraveSearchClient implements SearchClient {
    constructor(apiKey: string, fetchFn: typeof fetch = fetch)
  }
  export function buildSearchTools(client: SearchClient, deps?: SearchToolDeps): Tool[]
  export interface SearchToolDeps { fetchFn?: typeof fetch; lookup?: (host: string) => Promise<string[]> }
  ```
  Task 4 fills in `fetch_page`; this task makes `buildSearchTools` return `web_search` only and Task 4 appends the second tool.

- [ ] **Step 1: Write the failing tests**

Create `ts-backend/tests/search.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx tests/search.test.ts`
Expected: `Cannot find module '../src/search.js'`.

- [ ] **Step 3: Create search.ts with the client and web_search**

```ts
import type { Tool } from "./tools.js";

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchClient {
  search(query: string, count: number): Promise<SearchResult[]>;
}

export interface SearchToolDeps {
  fetchFn?: typeof fetch;
  /** Resolve a hostname to its addresses; injected by tests. */
  lookup?: (host: string) => Promise<string[]>;
}

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 8;
const DEFAULT_RESULTS = 5;

export class BraveSearchClient implements SearchClient {
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async search(query: string, count: number): Promise<SearchResult[]> {
    const url = BRAVE_URL + "?" + new URLSearchParams({ q: query, count: String(count) });
    const res = await this.fetchFn(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Brave Search returned HTTP ${res.status}`);
    const body: any = await res.json();
    const results: any[] = body?.web?.results ?? [];
    return results.map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      description: String(r.description ?? ""),
    }));
  }
}

function clampCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(n)));
}

export function buildSearchTools(client: SearchClient, deps: SearchToolDeps = {}): Tool[] {
  const webSearch: Tool = {
    name: "web_search",
    description:
      "Search the web. Returns up to 8 results with title, url and a short " +
      "description. Use it for current events and anything you are unsure about.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "integer", description: "Number of results, 1 to 8 (default 5)" },
      },
      required: ["query"],
    },
    async handler(args) {
      const query = String(args.query ?? "").trim();
      if (!query) return { error: "query is required" };
      const results = await client.search(query, clampCount(args.count));
      return { results };
    },
  };
  return [webSearch];
}
```

Note: `executeTool` in `tools.ts` already converts a thrown error into `{ error: message }`, which is why the Brave error test passes without a try/catch here. `deps` is unused until Task 4; keep the parameter so the signature is stable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx tests/search.test.ts`
Expected: all three pass.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (an unused `deps` parameter is allowed by the current tsconfig; if `noUnusedParameters` complains, rename it `_deps`, and Task 4 renames it back).

```bash
git add ts-backend/src/search.ts ts-backend/tests/search.test.ts
git commit -m "Add a Brave-backed web_search tool for chat"
```

---

### Task 4: fetch_page tool with private-address guard

**Files:**
- Modify: `ts-backend/src/search.ts`
- Test: `ts-backend/tests/search.test.ts`

**Interfaces:**
- Produces: `export function isPrivateAddress(ip: string): boolean`, `export function htmlToText(html: string): { title: string; text: string }`, and a second tool `fetch_page` from `buildSearchTools`.

- [ ] **Step 1: Write the failing tests**

Append to `ts-backend/tests/search.test.ts`:

```ts
import { htmlToText, isPrivateAddress } from "../src/search.js";

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
```

Move the `import { htmlToText, isPrivateAddress }` line to the top of the file with the other imports (or merge it into the existing `../src/search.js` import).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx tests/search.test.ts`
Expected: failures for the missing exports and for `unknown tool: fetch_page`.

- [ ] **Step 3: Implement the guard, the HTML reducer, and fetch_page**

In `ts-backend/src/search.ts`, add the following. Imports at the top:

```ts
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
```

Constants next to the existing ones:

```ts
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_MAX_CHARS = 20_000;
const MAX_REDIRECTS = 5;
```

Address check (after `clampCount`):

```ts
function ipv4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** Loopback, unspecified, link-local, and RFC 1918 / ULA ranges. */
export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith("[") && addr.endsWith("]")) addr = addr.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) addr = mapped[1];
  const v4 = ipv4Parts(addr);
  if (v4) {
    const [a, b] = v4;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(addr) === 6) {
    if (addr === "::1" || addr === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;          // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true;          // fe80::/10
    return false;
  }
  return true; // not an IP literal at all: treat as unsafe
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
}

async function assertSafeUrl(raw: string, lookup: (host: string) => Promise<string[]>): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only http and https URLs can be fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host);
  if (!addresses.length) throw new Error("host does not resolve");
  if (addresses.some(isPrivateAddress)) throw new Error("refusing to fetch a private or local address");
  return url;
}
```

HTML reduction:

```ts
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
  let s = html
    .replace(/<(script|style|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(p|div|br|h[1-6]|li|ul|ol|tr|td|th|table|section|article|header|footer|nav|blockquote|pre|hr|dd|dt|dl|figure|figcaption|main|aside)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  const text = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  return { title, text };
}
```

Bounded body read and the tool, inside `buildSearchTools` after `webSearch`:

```ts
  const fetchFn = deps.fetchFn ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;

  async function readCapped(res: Response): Promise<string> {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      if (total > PAGE_MAX_BYTES) {
        chunks.push(value.subarray(0, value.byteLength - (total - PAGE_MAX_BYTES)));
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
  }

  const fetchPage: Tool = {
    name: "fetch_page",
    description:
      "Fetch a public web page and return its readable text (up to 20,000 " +
      "characters). Use it to read a search result in full.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
    async handler(args) {
      let url = await assertSafeUrl(String(args.url ?? ""), lookup);
      let res: Response | null = null;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetchFn(url.toString(), {
          redirect: "manual",
          headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "SAWOT/0.1 (+chat fetch_page)" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
          url = await assertSafeUrl(new URL(location, url).toString(), lookup);
          continue;
        }
        break;
      }
      if (!res) throw new Error("no response");
      if (!res.ok) throw new Error(`page returned HTTP ${res.status}`);
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!type.startsWith("text/html") && !type.startsWith("text/plain")) {
        throw new Error("unsupported content type: " + (type || "unknown"));
      }
      const body = await readCapped(res);
      const { title, text } = type.startsWith("text/plain") ? { title: "", text: body.trim() } : htmlToText(body);
      const truncated = text.length > PAGE_MAX_CHARS;
      return { url: url.toString(), title, text: truncated ? text.slice(0, PAGE_MAX_CHARS) : text, truncated };
    },
  };
  return [webSearch, fetchPage];
```

Also change the earlier `return [webSearch];` so the function has one return at the end.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx tests/search.test.ts`
Expected: all pass. If the `htmlToText` expected string differs only in whitespace, fix the reducer, not the test: the target output is one trimmed line per block element.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add ts-backend/src/search.ts ts-backend/tests/search.test.ts
git commit -m "Add a fetch_page tool that refuses private and local addresses"
```

---

### Task 5: Conversation Home Assistant flag and empty tool list

**Files:**
- Modify: `ts-backend/src/chat.ts` (`ChatStore.create`, `ChatStore.list`, `runChat` request)
- Modify: `ts-backend/src/chatRoutes.ts` (create and patch handlers only)
- Test: `ts-backend/tests/chatRoutes.test.ts` (new), `ts-backend/tests/chatDebug.test.ts` (one addition)

**Interfaces:**
- Produces: `ChatStore.create(model: string, homeAssistant = false)`; conversation objects and listing entries carry `homeAssistant: boolean`.
- `runChat` request body omits `tools` when the list is empty.

- [ ] **Step 1: Write the failing tests**

Create `ts-backend/tests/chatRoutes.test.ts`:

```ts
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
  // A file written before the flag existed reads as off.
  writeFileSync(join(root, "abcdefabcdef.json"), JSON.stringify({ id: "abcdefabcdef", title: "Old", model: "m", created: 1, updated: 1, messages: [] }));
  const listing = store.list();
  assert.deepEqual(listing.map((c) => [c.id, c.homeAssistant]).sort(), [[off.id, false], [on.id, true], ["abcdefabcdef", false]].sort());
});

function harness(opts: Partial<ChatCtx> = {}) {
  const dir = tmp();
  const ctx: ChatCtx = {
    store: new ChatStore(join(dir, "conversations")),
    resolve: () => { throw new Error("no model in this test"); },
    haTools: [],
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
    res = await app.inject({ method: "PATCH", url: `/api/chat/conversations/${id}`, payload: { homeAssistant: false } });
    assert.equal(res.json().homeAssistant, false);
    res = await app.inject({ method: "GET", url: `/api/chat/conversations/${id}` });
    assert.equal(res.json().homeAssistant, false, "the change is persisted");
    res = await app.inject({ method: "GET", url: "/api/chat/conversations" });
    assert.equal(res.json().find((c: any) => c.id === id).homeAssistant, false);
  } finally { await app.close(); }
});
```

Add to `ts-backend/tests/chatDebug.test.ts`:

```ts
test("an empty tool list leaves the tools field out of the request", async () => {
  const requests: any[] = [];
  const client = { chat: { completions: { create: async (body: any) => { requests.push(body); return stream([{ choices: [{ delta: { content: "hi" } }] }]); } } } };
  for await (const _ of runChat(client, "m", [], "sys", [{ role: "user", content: "hey" }])) { /* drain */ }
  assert.equal("tools" in requests[0], false);
  assert.equal(requests[0].stream, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx tests/chatRoutes.test.ts; node --import tsx tests/chatDebug.test.ts`
Expected: chatRoutes fails on `homeAssistant` being `undefined` (and a type error on the `ChatCtx` fields, which Task 6 defines; tsx does not type-check, so the run proceeds). chatDebug fails with `true !== false`.

- [ ] **Step 3: Implement the store flag and the empty-tools request**

In `ts-backend/src/chat.ts`:

Replace `ChatStore.create`:

```ts
  create(model: string, homeAssistant = false): any {
    const now = Date.now() / 1000;
    const conv = { id: newId(), title: "New chat", model, homeAssistant, created: now, updated: now, messages: [] };
    this.save(conv);
    return conv;
  }
```

In `ChatStore.get`, normalise the flag so old files read as `false`. Replace the `try` body:

```ts
      const conv = JSON.parse(readFileSync(p, "utf8"));
      conv.homeAssistant = Boolean(conv.homeAssistant);
      return conv;
```

In `ChatStore.list`, add the flag to the pushed entry:

```ts
        out.push({
          id: conv.id, title: conv.title, model: conv.model,
          homeAssistant: Boolean(conv.homeAssistant),
          created: conv.created, updated: conv.updated,
        });
```

In `runChat`, replace the `tools: toOpenAiTools(tools),` line inside the `createChatCompletion` call with:

```ts
      ...(tools.length ? { tools: toOpenAiTools(tools) } : {}),
```

In `ts-backend/src/chatRoutes.ts`:

Replace the create handler:

```ts
  app.post("/api/chat/conversations", async (req: any) => {
    const body = req.body ?? {};
    const model = body.model || ctx.getDefaultModel();
    return ctx.store.create(model, Boolean(body.homeAssistant));
  });
```

In the patch handler, after `if ("model" in body) conv.model = String(body.model);` add:

```ts
    if ("homeAssistant" in body) conv.homeAssistant = Boolean(body.homeAssistant);
```

- [ ] **Step 4: Run the tests**

Run: `node --import tsx tests/chatRoutes.test.ts; node --import tsx tests/chatDebug.test.ts`
Expected: the store test and the chatDebug test pass. The route test may still fail on the harness's `ChatCtx` fields until Task 6 (the handler ignores unknown fields, so it should pass; if `registerChatRoutes` throws on the missing `tools`/`getSystemPrompt` it is because Task 6 has not run yet and that is expected).

- [ ] **Step 5: Commit**

Do not run typecheck yet; the harness references the Task 6 `ChatCtx` shape.

```bash
git add ts-backend/src/chat.ts ts-backend/src/chatRoutes.ts ts-backend/tests/chatRoutes.test.ts ts-backend/tests/chatDebug.test.ts
git commit -m "Store a per-conversation Home Assistant flag and omit empty tool lists"
```

---

### Task 6: Chat route builds prompt and tools per request

**Files:**
- Modify: `ts-backend/src/chatRoutes.ts` (`ChatCtx`, message handler)
- Modify: `ts-backend/src/index.ts` (chat context wiring)
- Test: `ts-backend/tests/chatRoutes.test.ts`

**Interfaces:**
- Consumes: `buildChatSystemPrompt`, `todayLabel` (Task 2); `buildSearchTools`, `BraveSearchClient` (Tasks 3 and 4); `config.braveApiKey` (Task 1).
- Produces the new `ChatCtx`:
  ```ts
  export interface ChatCtx {
    store: ChatStore;
    resolve: (model: string) => { client: any; model: string };
    haTools: Tool[];
    searchTools: Tool[];
    ha: HomeAssistant | null;
    uploadDir: string;
    name: string;
    getEntitySummary: () => string;
    getChatInstructions: () => string;
    getDefaultModel: () => string;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Append to `ts-backend/tests/chatRoutes.test.ts`:

```ts
async function* once(text: string) { yield { choices: [{ delta: { content: text } }] }; }

function recordingClient(requests: any[]) {
  return { chat: { completions: { create: async (body: any) => { requests.push(body); return once("done"); } } } };
}

function sseEvents(body: string): any[] {
  return body.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

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
```

Note: `maybeTitle` calls the model again after the reply to title the conversation; `recordingClient` answers it with "done", so `requests[0]` is the chat request and `requests[1]` the title request. Do not assert on `requests.length`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx tests/chatRoutes.test.ts`
Expected: the three new tests fail (`ctx.tools` undefined or `ctx.getSystemPrompt is not a function`).

- [ ] **Step 3: Rewrite ChatCtx and the message handler**

In `ts-backend/src/chatRoutes.ts`:

Add the import:

```ts
import { buildChatSystemPrompt, todayLabel } from "./chatPrompt.js";
```

Replace the `ChatCtx` interface:

```ts
export interface ChatCtx {
  store: ChatStore;
  /** Resolve a (possibly provider-qualified) model id to its client. */
  resolve: (model: string) => { client: any; model: string };
  /** Home Assistant tools, offered only when the conversation asks for them. */
  haTools: Tool[];
  /** web_search and fetch_page; empty when no search key is configured. */
  searchTools: Tool[];
  ha: HomeAssistant | null;
  uploadDir: string;
  /** Assistant name from config. */
  name: string;
  getEntitySummary: () => string;
  getChatInstructions: () => string;
  getDefaultModel: () => string;
}
```

In the message handler, replace these lines inside the `try`:

```ts
      const history = toOpenAiMessages(conv.messages, ctx.uploadDir);
      const getCards = ctx.ha ? (ids: string[]) => ctx.ha!.getCards(ids) : undefined;
      const llm = ctx.resolve(conv.model);
      for await (const [event, data] of runChat(
        llm.client, llm.model, ctx.tools, ctx.getSystemPrompt(), history, getCards,
      )) {
```

with:

```ts
      const history = toOpenAiMessages(conv.messages, ctx.uploadDir);
      const homeAssistant = Boolean(conv.homeAssistant);
      const tools = [...ctx.searchTools, ...(homeAssistant ? ctx.haTools : [])];
      const system = buildChatSystemPrompt({
        name: ctx.name,
        instructions: ctx.getChatInstructions(),
        today: todayLabel(),
        homeAssistant,
        entitySummary: ctx.getEntitySummary(),
        search: ctx.searchTools.length > 0,
      });
      const getCards = homeAssistant && ctx.ha ? (ids: string[]) => ctx.ha!.getCards(ids) : undefined;
      const llm = ctx.resolve(conv.model);
      for await (const [event, data] of runChat(
        llm.client, llm.model, tools, system, history, getCards,
      )) {
```

- [ ] **Step 4: Wire the context in index.ts**

In `ts-backend/src/index.ts`:

Add the import:

```ts
import { BraveSearchClient, buildSearchTools } from "./search.js";
```

Replace the `chatCtx` block:

```ts
  const searchTools = config.braveApiKey
    ? buildSearchTools(new BraveSearchClient(config.braveApiKey))
    : [];
  const chatCtx: ChatCtx = {
    store: new ChatStore(join(dataDir, "data", "conversations")),
    resolve: (model) => registry.resolve(model),
    haTools: tools,
    searchTools,
    ha,
    uploadDir: join(dataDir, "data", "uploads"),
    name: config.assistantName,
    getEntitySummary: () => summary,
    getChatInstructions: () => state.chatInstructions,
    getDefaultModel: () => state.model,
  };
  registerChatRoutes(app, chatCtx);
```

`state.chatInstructions` does not exist until Task 7. To keep this task compiling, add it now in the same file: in the `state: SettingsState = { ... }` literal add

```ts
    chatInstructions: String(overrides.chatInstructions ?? "").trim().slice(0, 2000),
```

and in `ts-backend/src/settings.ts` add to `SettingsState`:

```ts
  /** Extra system-prompt instructions for Chat mode; blank means neutral. */
  chatInstructions: string;
```

Task 7 adds validation, persistence, and the payload.

`summary` is a `let` that is reassigned after Home Assistant loads; the closure reads the current value at request time, which is the intended behaviour.

- [ ] **Step 5: Run the tests and typecheck**

Run: `node --import tsx tests/chatRoutes.test.ts && node --import tsx tests/personality.test.ts && npm run typecheck`
Expected: all pass. The personality test's harness builds a `state` object without `chatInstructions`; it is typed `any`, so it compiles.

- [ ] **Step 6: Commit**

```bash
git add ts-backend/src/chatRoutes.ts ts-backend/src/index.ts ts-backend/src/settings.ts ts-backend/tests/chatRoutes.test.ts
git commit -m "Give chat its own system prompt, search tools, and optional Home Assistant tools"
```

---

### Task 7: chatInstructions setting

**Files:**
- Modify: `ts-backend/src/settings.ts` (`persist`, `settingsPayload`, POST handler)
- Test: `ts-backend/tests/personality.test.ts`

**Interfaces:**
- Consumes: `SettingsState.chatInstructions` (added in Task 6).
- Produces: `GET /api/settings` returns `chatInstructions`; `POST /api/settings` accepts it.

- [ ] **Step 1: Write the failing test**

In `ts-backend/tests/personality.test.ts`, add `chatInstructions: ""` to the `state` literal inside `harness`, then append:

```ts
test("chat instructions are validated, trimmed, saved, and returned", async () => {
  const llm = await llmServer(() => "unused");
  const { app, state, saved, prompts } = await harness(llm.url);
  try {
    let res = await app.inject({ method: "GET", url: "/api/settings" });
    assert.equal(res.json().chatInstructions, "");
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: "  Prefer Python.  " } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().chatInstructions, "Prefer Python.");
    assert.equal(state.chatInstructions, "Prefer Python.");
    assert.equal(saved.at(-1).chatInstructions, "Prefer Python.");
    assert.equal(prompts.length, 0, "chat instructions do not touch the voice prompt");
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: "x".repeat(2001) } });
    assert.equal(res.statusCode, 400);
    res = await app.inject({ method: "POST", url: "/api/settings", payload: { chatInstructions: 42 } });
    assert.equal(res.statusCode, 400);
  } finally { await app.close(); llm.close(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx tests/personality.test.ts`
Expected: the new test fails at `res.json().chatInstructions` being `undefined`.

- [ ] **Step 3: Implement**

In `ts-backend/src/settings.ts`:

Add a constant near the imports:

```ts
/** Longest chat instructions accepted, in characters. */
export const CHAT_INSTRUCTIONS_MAX = 2000;
```

In `persist`, add after `personalityPrompt: ctx.state.personalityPrompt,`:

```ts
    chatInstructions: ctx.state.chatInstructions,
```

In `settingsPayload`, add after `personalityPrompt: ctx.state.personalityPrompt,`:

```ts
    chatInstructions: ctx.state.chatInstructions,
```

In the POST handler, after `const detailedDrawings = body.detailedDrawings;` add:

```ts
    const chatInstructions = body.chatInstructions;
```

After the `personalityPrompt` validation block add:

```ts
    if (chatInstructions !== undefined && (typeof chatInstructions !== "string" || chatInstructions.length > CHAT_INSTRUCTIONS_MAX)) {
      return reply.code(400).send({ detail: `chat instructions must be text of at most ${CHAT_INSTRUCTIONS_MAX} characters` });
    }
```

Before `persist(ctx);` add:

```ts
    if (chatInstructions !== undefined) ctx.state.chatInstructions = chatInstructions.trim();
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `node --import tsx tests/personality.test.ts && npm run typecheck`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add ts-backend/src/settings.ts ts-backend/tests/personality.test.ts
git commit -m "Add a chat instructions setting"
```

---

### Task 8: Home Assistant toggle in the chat header

**Files:**
- Modify: `web/src/chatStore.ts`
- Modify: `web/src/components/chat/ChatHeader.tsx`

**Interfaces:**
- Consumes: `PATCH /api/chat/conversations/:cid` with `{ homeAssistant }` (Task 5); `active.homeAssistant`.
- Produces: store action `setHomeAssistant(on: boolean)`.

The web package has no unit test runner for components; verification is typecheck, build, and the browser check in Task 11.

- [ ] **Step 1: Add the store action**

In `web/src/chatStore.ts`, after the `renameModel` action add:

```ts
  setHomeAssistant: async (homeAssistant) => {
    const { activeId } = get();
    if (!activeId) return;
    try {
      const updated = await patchConversation(activeId, { homeAssistant });
      set((s) => ({
        active: s.active ? { ...s.active, homeAssistant: updated.homeAssistant } : s.active,
        conversations: s.conversations.map((c) =>
          c.id === activeId ? { ...c, homeAssistant: updated.homeAssistant } : c
        ),
      }));
    } catch (e) {
      console.error("setHomeAssistant failed", e);
    }
  },
```

- [ ] **Step 2: Add the toggle to the header**

Replace `web/src/components/chat/ChatHeader.tsx`:

```tsx
import { useChatStore } from "../../chatStore";
import ModelPicker from "../ModelPicker";
import { useProviders } from "./useModels";

const House = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-6h4v6" />
  </svg>
);

export default function ChatHeader() {
  const active = useChatStore((s) => s.active);
  const renameModel = useChatStore((s) => s.renameModel);
  const setHomeAssistant = useChatStore((s) => s.setHomeAssistant);
  const providers = useProviders();

  if (!active) return null;
  const ha = Boolean(active.homeAssistant);

  return (
    <header className="chat-header">
      <h2 className="min-w-0 flex-1 truncate font-sans text-base font-medium text-zinc-100">
        {active.title}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setHomeAssistant(!ha)}
          aria-pressed={ha}
          aria-label={ha ? "Home Assistant on" : "Home Assistant off"}
          title={ha ? "Home Assistant tools are on for this chat" : "Turn on Home Assistant tools for this chat"}
          className={`grid h-8 w-8 place-items-center rounded-full border transition-colors duration-200 ${
            ha
              ? "border-white/15 bg-white/[0.08] text-zinc-100"
              : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          }`}
        >
          <House />
        </button>
        <div className="flex w-[min(280px,45vw)] items-center gap-2">
          <span className="text-xs text-zinc-500">Model</span>
          <ModelPicker compact value={active.model} providers={providers} onChange={renameModel} />
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run from `web/`: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add web/src/chatStore.ts web/src/components/chat/ChatHeader.tsx
git commit -m "Add a per-conversation Home Assistant toggle to the chat header"
```

---

### Task 9: Chat instructions row in Settings

**Files:**
- Modify: `web/src/components/settings/AssistantSection.tsx`

**Interfaces:**
- Consumes: `data.chatInstructions` from `GET /api/settings`; `update({ chatInstructions })` posts to the settings API (Task 7).

- [ ] **Step 1: Add the component and the row**

In `web/src/components/settings/AssistantSection.tsx`, add above `export default function AssistantSection`:

```tsx
function ChatInstructions({ value, onChange }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const dirty = draft.trim() !== (value ?? "").trim();
  return (
    <div className="flex flex-col gap-2.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="How the assistant should behave in chat, e.g. “Answer concisely, prefer Python examples, call me Ed.” Leave empty for a neutral assistant."
        aria-label="Chat instructions"
        rows={5}
        maxLength={2000}
        className={`${FIELD_CLS} resize-y leading-snug`}
      />
      <p className="-mt-1 text-[0.78rem] leading-snug text-zinc-500">
        Applies to Chat only. Voice keeps its personality above.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ chatInstructions: draft.trim() })}
          disabled={!dirty}
          className={BUTTON_CLS}
        >
          Save instructions
        </button>
        {dirty && <span className="text-[0.72rem] text-zinc-500">Unsaved changes</span>}
      </div>
    </div>
  );
}
```

In `AssistantSection`, compute the summary before `return`:

```tsx
  const instructions = String(data.chatInstructions ?? "").trim();
  const instructionsSummary = instructions ? (instructions.length > 40 ? instructions.slice(0, 40) + "…" : instructions) : "Default";
```

After the Personality `<Disclosure>` and before the closing `</div>` of the row group, add:

```tsx
        <Disclosure id="chat-instructions" title="Chat instructions" summary={instructionsSummary} open={openRow === "chat-instructions"} onToggle={() => toggle("chat-instructions")}>
          <ChatInstructions value={data.chatInstructions ?? ""} onChange={update} />
        </Disclosure>
```

- [ ] **Step 2: Typecheck and build**

Run from `web/`: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/settings/AssistantSection.tsx
git commit -m "Add a chat instructions row to the Assistant settings"
```

---

### Task 10: Documentation and CI

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: README**

In the Features list, replace the `**Chat**` bullet (starts "a ChatGPT-style interface") with:

```markdown
- **Chat** — a general-purpose AI chat with multiple server-stored
  conversations, streaming replies, collapsible reasoning, image/text/PDF
  uploads, web search with a Brave key, and a per-conversation switch that
  brings in the Home Assistant tools and inline device cards.
```

Replace the `### Chat (speech-bubble icon)` section body with:

```markdown
A general-purpose assistant for everyday use, not a home controller. Multiple
server-stored conversations (`data/conversations/`), streaming replies with
collapsible thinking, a per-conversation model picker, image/text/PDF uploads,
and markdown with highlighted code blocks. With a Brave Search key configured
the model can call `web_search` and `fetch_page` and cites its sources as
links. The house button in the header turns Home Assistant on for that
conversation: the device list, the HA tools, and inline device cards. Chat has
its own instructions in Settings → Assistant, separate from the voice
personality.
```

In the `### Settings (gear icon)` paragraph, after "or a custom brief you write or have the model write)," insert "chat instructions,".

In the Configuration key table add, after the `assistant.personality_prompt` row:

```markdown
| `search.brave_api_key` | Brave Search API key; enables web search in Chat (optional) |
```

In the environment variable table add, after the `ASSISTANT_NAME` row:

```markdown
| `BRAVE_API_KEY` | `search.brave_api_key` |
```

After the sentence "Keys are never returned by the API." add:

```markdown
The Brave key is treated the same way: it is read from `config.yaml` or the
environment and never logged or returned.
```

- [ ] **Step 2: AGENTS.md**

Change the project line to:

```markdown
SAWOT is a voice assistant for Home Assistant with a general-purpose chat mode
that can bring the home tools in per conversation. Preserve its minimal,
orb-centered interface and fluid ink animation. The GitHub repository is
`Edmasoud95/sawot` and is public.
```

In the Architecture list, change the `ts-backend/` line to end with "..., chat prompt and Brave web search tools (`chatPrompt.ts`, `search.ts`), provider registry (...), and settings." keeping the existing wording around it.

Add to the `ts-backend/` test command list:

```sh
node --import tsx tests/chatPrompt.test.ts
node --import tsx tests/search.test.ts
node --import tsx tests/chatRoutes.test.ts
```

- [ ] **Step 3: CI**

In `.github/workflows/ci.yml`, in the step that runs `node --import tsx tests/activity.test.ts`, add lines after it:

```yaml
          node --import tsx tests/chatPrompt.test.ts
          node --import tsx tests/search.test.ts
          node --import tsx tests/chatRoutes.test.ts
          node --import tsx tests/personality.test.ts
```

(Check whether `personality.test.ts` is already listed; add it only if absent.)

- [ ] **Step 4: Check and commit**

Run from the repo root: `git diff --check`
Expected: no output.

```bash
git add README.md AGENTS.md .github/workflows/ci.yml
git commit -m "Document the general chat mode, web search key, and chat instructions"
```

---

### Task 11: Full verification in the running app

**Files:** none modified unless a defect is found.

- [ ] **Step 1: Run every backend test and both typechecks**

From `ts-backend/`:

```sh
for t in tests/*.test.ts; do node --import tsx "$t" || echo "FAILED $t"; done
npm run typecheck && npm run build
```

From `web/`: `npm run typecheck && npm run build`

Expected: no `FAILED` lines, no type errors, both builds succeed.

- [ ] **Step 2: Start the app**

Add `BRAVE_API_KEY=<real key>` to `.env` if one is available (never commit `.env`). From the repo root run `./run.sh` (it uses the `dist/` directories just built; the memory note says the Windows-host LM Studio model must be loaded and only one model resident).

- [ ] **Step 3: General conversation**

Open the app, switch to Chat, start a new conversation. Confirm:
- The house button is unpressed.
- Ask "Explain the difference between TCP and UDP with a comparison table." The answer is multi-paragraph markdown with a table, not a two-sentence spoken reply.
- If a Brave key is set: ask "What is today's top technology headline?" A `web_search` chip appears while streaming and the answer contains at least one markdown link. Ask it to "read the first result and summarise it": a `fetch_page` chip appears.
- Open the debug bar if needed to confirm the system prompt has no `Devices:` block (the `debug` events include the request round; alternatively check `data/conversations/<id>.json` has `"homeAssistant": false`).

- [ ] **Step 4: Home Assistant conversation**

Press the house button (it becomes pressed and its label reads "Home Assistant on"). Ask about a light's state. A `get_entities` chip appears and a device card renders under the reply. Reload the page and reopen the conversation: the button is still pressed.

- [ ] **Step 5: Settings**

Open Settings → Assistant → Chat instructions. Enter "Always answer in British English and sign off with 'Cheers'." and save. Start a new chat and confirm the sign-off appears. Confirm the voice personality row is unchanged and voice replies still sound like the chosen personality.

- [ ] **Step 6: Phone width**

Resize the browser to 390 px wide. The chat header stacks; the house button and model picker sit on one row without overflow. The Chat instructions row expands and the textarea fits.

- [ ] **Step 7: Report**

Report what was actually verified, including whether a Brave key was available for the live search checks. If any step failed, fix it with a new test where possible and commit the fix before reporting.
