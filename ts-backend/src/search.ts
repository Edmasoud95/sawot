import { fetchPublic, publicAddress } from "./publicFetch.js";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Tool } from "./tools.js";

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  favicon?: string;
}

function faviconMetadata(value: unknown): { favicon?: string } {
  try {
    if (typeof value !== "string") return {};
    const url = new URL(value);
    if (url.origin === "https://imgs.search.brave.com" && !url.username && !url.password) return { favicon: url.href };
  } catch { /* Missing or untrusted icons use the UI's globe fallback. */ }
  return {};
}

export interface SearchClient {
  search(query: string, count: number): Promise<SearchResult[]>;
}

/** Product metadata only: never send page bodies or diagnostic errors to the
 * voice source list. Build it from tool results, not model-generated citations. */
export function voiceSearchSources(tool: string, result: any) {
  if (!result || result.error) return [];
  const pages = tool === "web_search" ? result.results : [result];
  if (!Array.isArray(pages)) return [];
  return pages.slice(0, MAX_RESULTS).flatMap((page) => {
    try {
      if (typeof page?.url !== "string") return [];
      const url = new URL(page.url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return [];
      return [{
        url: url.href,
        title: typeof page.title === "string" ? page.title.slice(0, 240) : url.hostname,
        read: tool === "fetch_page" || tool === "find_in_page",
        ...faviconMetadata(page.favicon),
      }];
    } catch { return []; }
  });
}

export interface SearchToolDeps {
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Resolve a hostname to its addresses; injected by tests. */
  lookup?: (host: string) => Promise<string[]>;
}

const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 10_000;
const MAX_RESULTS = 8;
const DEFAULT_RESULTS = 5;
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_MAX_CHARS = 20_000;
const PAGE_CACHE_ENTRIES = 12;
const PAGE_CACHE_TTL_MS = 5 * 60 * 1000;

function retryDelay(headers: Headers, attempt: number): number {
  let seconds = 2 ** attempt;
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const value = /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    if (Number.isFinite(value)) seconds = Math.max(seconds, value);
  }
  const remaining = headers.get("x-ratelimit-remaining")?.split(",").map(Number);
  const resets = headers.get("x-ratelimit-reset")?.split(",").map(Number) ?? [];
  for (const [index, reset] of resets.entries()) {
    if (Number.isFinite(reset) && (remaining ? remaining[index] === 0 : index === 0)) seconds = Math.max(seconds, reset);
  }
  return seconds * 1000;
}

export class BraveSearchClient implements SearchClient {
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async search(query: string, count: number): Promise<SearchResult[]> {
    const url = BRAVE_URL + "?" + new URLSearchParams({ q: query, count: String(count) });
    // One deadline covers all attempts. Brief bursts can exceed Brave's
    // one-second window; long quota resets should fail promptly, not stall voice.
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await this.fetchFn(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": this.apiKey },
        signal,
      });
      if (res.status !== 429 || attempt >= 2) break;
      const wait = retryDelay(res.headers, attempt);
      if (wait > 3000) break;
      await res.body?.cancel();
      await delay(wait, undefined, { signal });
    }
    if (!res.ok) throw new Error(`Brave Search returned HTTP ${res.status}`);
    const body: any = await res.json();
    const results: any[] = body?.web?.results ?? [];
    return results.map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      description: String(r.description ?? ""),
      ...faviconMetadata(r.profile?.img),
    }));
  }
}

function clampCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RESULTS;
  return Math.min(MAX_RESULTS, Math.max(1, Math.round(n)));
}

/** Kept for callers/tests; all special-use addresses are now refused. */
export function isPrivateAddress(ip: string): boolean { return !publicAddress(ip); }
async function defaultLookup(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map(record => record.address);
}

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
    .replace(/<(script|style|noscript|svg|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
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
  const lookup = deps.lookup ?? defaultLookup;
  const now = deps.now ?? Date.now;
  type Page = { url: string; title: string; text: string; truncated: boolean };
  const pages = new Map<string, { page: Page; expires: number }>();

  async function loadPage(raw: string, useCache: boolean): Promise<Page> {
    const requested = new URL(raw);
    requested.hash = "";
    const key = requested.href;
    for (const [cachedKey, value] of pages) {
      if (value.expires <= now()) pages.delete(cachedKey);
    }
    const cached = pages.get(key);
    if (useCache && cached) {
      pages.delete(key);
      pages.set(key, cached);
      return cached.page;
    }
    const downloaded = await fetchPublic(key, {
      signal: AbortSignal.timeout(TIMEOUT_MS), deadlineMs: performance.now() + TIMEOUT_MS,
      maxBytes: PAGE_MAX_BYTES, oversize: "truncate",
    }, { resolve: lookup, ...(deps.fetchFn ? { connect: async (url: URL, _address: string, signal: AbortSignal) => {
      // Test-only connector injection. Production always uses IP-pinned sockets.
      const response = await deps.fetchFn!(url.toString(), { redirect: "manual", signal });
      return Object.assign(response.body ? Readable.fromWeb(response.body as any) : Readable.from([]), {
        statusCode: response.status, headers: Object.fromEntries(response.headers),
      }) as IncomingMessage;
    } } : {}) });
    const type = downloaded.mediaType.toLowerCase();
    if (!type.startsWith("text/html") && !type.startsWith("text/plain")) {
      downloaded.close();
      throw new Error("unsupported content type: " + (type || "unknown"));
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of downloaded.body) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const truncated = downloaded.truncated();
    const url = new URL(downloaded.finalUrl);
    const { title, text } = type.startsWith("text/plain") ? { title: "", text: body.trim() } : htmlToText(body);
    // Keep the extracted text from the bounded download, not just the preview.
    const page = { url: url.href, title, text, truncated };
    for (const [cachedKey, value] of pages) {
      if (value.page.url === page.url) pages.delete(cachedKey);
    }
    const entry = { page, expires: now() + PAGE_CACHE_TTL_MS };
    pages.set(key, entry);
    pages.set(page.url, entry);
    while (pages.size > PAGE_CACHE_ENTRIES) pages.delete(pages.keys().next().value!);
    return page;
  }

  const fetchPage: Tool = {
    name: "fetch_page",
    description:
      "Fetch a public web page and return up to 20,000 characters of readable text. " +
      "Longer text from the download is cached for find_in_page. Call fetch_page again to refresh it.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
    },
    async handler(args) {
      const page = await loadPage(String(args.url ?? ""), false);
      return { ...page, text: page.text.slice(0, PAGE_MAX_CHARS), truncated: page.truncated || page.text.length > PAGE_MAX_CHARS };
    },
  };

  const findInPage: Tool = {
    name: "find_in_page",
    description:
      "Find a literal phrase in a public page, ignoring case, and return matching passages with context. " +
      "Searches cached text beyond fetch_page's 20,000-character preview; fetches the page if not cached. " +
      "Cache lasts 5 minutes. Downloads are limited to 2 MiB; page_truncated means only part of the page was searched. " +
      "No regex. Try a shorter phrase when there are no matches.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL" },
        query: { type: "string", description: "Literal text to find, 1 to 200 characters" },
        count: { type: "integer", description: "Maximum matching passages, 1 to 10 (default 5)" },
      },
      required: ["url", "query"],
    },
    async handler(args) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query || query.length > 200) return { error: "query must contain 1 to 200 characters" };
      const value = Number(args.count);
      const count = Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : 5;
      const page = await loadPage(String(args.url ?? ""), true);
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches: { text: string; start: number; end: number }[] = [];
      let total = 0;
      for (const match of page.text.matchAll(pattern)) {
        total++;
        if (matches.length >= count) continue;
        const start = Math.max(0, match.index! - 250);
        const end = Math.min(page.text.length, match.index! + match[0].length + 250);
        matches.push({ text: page.text.slice(start, end), start, end });
      }
      return { url: page.url, title: page.title, query, matches, total_matches: total, has_more: total > matches.length, page_truncated: page.truncated };
    },
  };
  return [webSearch, fetchPage, findInPage];
}
