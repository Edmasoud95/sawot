export interface VoiceSource {
  url: string;
  title: string;
  read: boolean;
  favicon?: string;
}

export interface VoiceSearch {
  tool: "web_search" | "fetch_page" | "find_in_page";
  phase: "start" | "complete" | "error";
  sources: VoiceSource[];
}

function safeFavicon(value: unknown): string | undefined {
  try {
    if (typeof value !== "string") return;
    const url = new URL(value);
    if (url.origin === "https://imgs.search.brave.com" && !url.username && !url.password) return url.href;
  } catch { /* Invalid images fall back to a globe. */ }
}

export function voiceSearchStatus(search: VoiceSearch) {
  const busy = search.phase === "start";
  const hasSources = search.sources.length > 0;
  let status = hasSources ? `${search.sources.length} web sources` : "No results found";
  if (busy) status = search.tool === "find_in_page" ? "Searching a page…" : search.tool === "fetch_page" ? "Reading a page…" : "Searching the web…";
  else if (search.phase === "error") {
    status = hasSources
      ? `${status}; ${search.tool !== "web_search" ? "one page could not be read" : "an additional search failed"}`
      : search.tool !== "web_search" ? "Page could not be read" : "Search failed. Try again.";
  }
  return { busy, showSources: !busy && hasSources, status };
}

export function updateVoiceSearch(current: VoiceSearch | null, event: VoiceSearch): VoiceSearch | null {
  if (!["web_search", "fetch_page", "find_in_page"].includes(event.tool) ||
      !["start", "complete", "error"].includes(event.phase)) return current;
  const sources = new Map((current?.sources ?? []).map(source => [source.url, source]));
  if (event.phase === "complete" && Array.isArray(event.sources)) {
    for (const source of event.sources) {
      try {
        const url = new URL(source.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
        const previous = sources.get(url.href);
        const favicon = safeFavicon(source.favicon) ?? previous?.favicon;
        if (!previous && sources.size >= 40) continue;
        sources.set(url.href, {
          url: url.href,
          title: (typeof source.title === "string" && source.title.trim() ? source.title : url.hostname).slice(0, 240),
          read: previous?.read || source.read === true,
          ...(favicon ? { favicon } : {}),
        });
      } catch { /* malformed links cannot become clickable sources */ }
    }
  }
  return { tool: event.tool, phase: event.phase, sources: [...sources.values()] };
}
