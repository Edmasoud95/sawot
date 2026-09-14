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

export function buildSearchTools(client: SearchClient, _deps: SearchToolDeps = {}): Tool[] {
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
