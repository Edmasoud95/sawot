/** High-confidence URL rules only. Snippets may describe products on a search
 * page; their text must never turn that page into an individual product. */
export function searchPageKind(raw: string): 'product' | 'listing' | 'unknown' {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 'unknown';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (host === 'allegro.pl' || host.endsWith('.allegro.pl')) {
      if (/^\/(oferta|produkt)\/[^/]+/.test(path)) return 'product';
      if (path === '/' || /^\/(listing|kategoria|uzytkownik)(\/|$)/.test(path)) return 'listing';
    }
    // Detail routes take precedence over optional search/tracking parameters.
    if (/(^|\.)amazon\.(?:com|pl|de|fr|it|es|nl|se|be|ie|ca|in|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|sg|ae|sa|eg|co\.za)$/.test(host) && /\/(?:dp|gp\/product)\/[a-z0-9]{10}(?:\/|$)/.test(path)) return 'product';
    if (/(^|\.)ebay\.(?:com|pl|de|fr|it|es|nl|be|ie|ca|at|ch|co\.uk|com\.au)$/.test(host) && /^\/itm\/(?:[^/]+\/)?\d+(?:\/|$)/.test(path)) return 'product';
    if (/^\/products?\/[^/]+/.test(path) || /^\/collections\/[^/]+\/products\/[^/]+/.test(path)) return 'product';
    if (/^\/(search|search-results|listing|category|categories)(\/|$)/.test(path) ||
        /^\/collections\/[^/]+\/?$/.test(path) ||
        ['q', 'query', 'search', 'search_query', 'searchTerm', 'k', 'keywords'].some(key => url.searchParams.has(key))) return 'listing';
  } catch { /* Unknown formats remain unclassified. */ }
  return 'unknown';
}

/** A final inline citation is an explicit selection. Never promote uncited
 * search results, images, code examples, unknown page types or blocked pages. */
export function citedProductIds(text: string, sources: {id: string; url: string; blocked?: boolean}[]): string[] {
  const prose = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g, '');
  const ids = new Set<string>();
  for (const match of prose.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s]+?))(?:\s+"[^"]*")?\s*\)/g)) {
    try {
      const url = new URL(match[1] ?? match[2]);
      url.hash = '';
      const source = sources.find(source => source.url === url.href);
      if (source && !source.blocked && searchPageKind(source.url) === 'product') ids.add(source.id);
      if (ids.size === 12) break;
    } catch { /* Malformed citations cannot create cards. */ }
  }
  return [...ids];
}

/** Keep app-rendered selections in model history so follow-up questions have their context. */
export function presentationHistory(search: any): string {
  if (search?.presentationVersion !== 1 || !Array.isArray(search.presentations) || !Array.isArray(search.sources)) return '';
  const sections: string[] = [];
  for (const group of search.presentations.slice(0, 2)) {
    if (!['products', 'news'].includes(group?.kind) || !Array.isArray(group.ids)) continue;
    const lines: string[] = [];
    for (const id of [...new Set(group.ids.slice(0, 12))]) {
      const matches = search.sources.slice(0, 40).filter((source: any) => source?.id === id);
      if (matches.length !== 1 || typeof matches[0].title !== 'string') continue;
      const source = matches[0];
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
        lines.push(`- ${source.title.slice(0, 240).replace(/\s+/g, ' ')}: ${url.href}${source.blocked ? ' (link only; page could not be read)' : ''}`);
      } catch { /* Invalid stored metadata cannot become a source. */ }
    }
    if (lines.length) sections.push(`Displayed ${group.kind === 'products' ? 'products' : 'articles'}:\n${lines.join('\n')}`);
  }
  return sections.length ? '\n\n' + sections.join('\n\n') : '';
}
