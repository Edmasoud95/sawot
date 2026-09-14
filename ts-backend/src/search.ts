import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
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
const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const PAGE_MAX_CHARS = 20_000;
const MAX_REDIRECTS = 5;

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
    if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // fe80::/10
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
}
