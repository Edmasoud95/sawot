export interface Product { title: string; url: string; price?: string; description?: string }
export interface ProductCards { title: string; items: Product[] }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max;

/** Only an explicit, bounded product envelope opts a response into shopping cards. */
export function parseProductCards(source: string): ProductCards | null {
  if (source.length > 30_000) return null;
  try {
    const data = JSON.parse(source)?.product_cards_v1;
    if (!data || !text(data.title, 160) || !Array.isArray(data.items) || !data.items.length || data.items.length > 12) return null;
    const items: Product[] = [];
    const seen = new Set<string>();
    for (const item of data.items) {
      if (!item || !text(item.title, 240) || !text(item.url, 4096) ||
        (item.price !== undefined && !text(item.price, 80)) ||
        (item.description !== undefined && !text(item.description, 320))) return null;
      const url = new URL(item.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      items.push({ title: item.title.trim(), url: url.href,
        ...(item.price ? {price: item.price.trim()} : {}), ...(item.description ? {description: item.description.trim()} : {}) });
    }
    return { title: data.title.trim(), items };
  } catch { return null; }
}
