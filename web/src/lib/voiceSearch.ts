export interface VoiceSource {
  id?: string;
  blocked?: boolean;
  url: string;
  title: string;
  read: boolean;
  favicon?: string;
  thumbnail?: string;
  pageKind?: 'product' | 'listing' | 'unknown';
}

export interface VoiceSearch {
  presentationVersion?: 1;
  productSearch?: boolean;
  presentations?: { kind: 'products' | 'news'; ids: string[] }[];
  tool: "web_search" | "fetch_page" | "find_in_page";
  phase: "start" | "complete" | "error";
  sources: VoiceSource[];
  query?: string;
}

function safeFavicon(value: unknown): string | undefined {
  try {
    if (typeof value !== "string" || value.length > 4096) return;
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
  if (["complete", "error"].includes(event.phase) && Array.isArray(event.sources)) {
    for (const source of event.sources) {
      try {
        const url = new URL(source.url);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) continue;
        const previous = sources.get(url.href);
        const favicon = safeFavicon(source.favicon) ?? previous?.favicon;
        const thumbnail = safeFavicon(source.thumbnail) ?? previous?.thumbnail;
        const pageKind = ['product', 'listing', 'unknown'].includes(source.pageKind) ? source.pageKind : previous?.pageKind;
        if (!previous && sources.size >= 40) continue;
        sources.set(url.href, {
          url: url.href,
          title: (typeof source.title === "string" && source.title.trim() ? source.title : url.hostname).slice(0, 240),
          read: previous?.read || source.read === true,
          ...((typeof source.id === 'string' && /^r(?:[1-9]|[1-3]\d|40)$/.test(source.id)) ? {id: source.id} : previous?.id ? {id: previous.id} : {}),
          ...((source.blocked === true || previous?.blocked) ? {blocked: true, read: false} : {}),
          ...(favicon ? { favicon } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          ...(pageKind ? { pageKind } : {}),
        });
      } catch { /* malformed links cannot become clickable sources */ }
    }
  }
  const query = event.tool === "web_search" && event.phase === "start" && typeof event.query === "string"
    ? event.query.trim() : "";
  const deterministic = event.presentationVersion === 1 || current?.presentationVersion === 1;
  const groups = event.presentations ?? current?.presentations ?? [];
  const presentations: NonNullable<VoiceSearch['presentations']> = [];
  const ids = [...sources.values()].map(source => source.id).filter(Boolean);
  if (deterministic && Array.isArray(groups)) for (const group of groups.slice(0, 2)) {
    if (!group || !['products', 'news'].includes(group.kind) || presentations.some(p => p.kind === group.kind) ||
        !Array.isArray(group.ids) || !group.ids.length || group.ids.length > 12 ||
        group.ids.some(id => typeof id !== 'string' || ids.filter(known => known === id).length !== 1)) continue;
    presentations.push({kind: group.kind, ids: [...new Set(group.ids)]});
  }
  return { tool: event.tool, phase: event.phase, sources: [...sources.values()], ...(query ? { query } : {}),
    ...(event.productSearch || current?.productSearch ? {productSearch: true} : {}),
    ...(deterministic ? {presentationVersion: 1, presentations} : {}) };
}
