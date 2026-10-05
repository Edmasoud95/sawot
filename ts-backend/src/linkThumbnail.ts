import type { FastifyInstance } from 'fastify';
import { fetchPublic } from './publicFetch.js';

function decode(value: string) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function attributes(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs.set(match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4]));
  }
  return attrs;
}

function amazonPage(raw: string): boolean {
  try {
    return /(^|\.)amazon\.(?:com|pl|de|fr|it|es|nl|se|be|ie|ca|in|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|sg|ae|sa|eg|co\.za)$/.test(new URL(raw).hostname);
  } catch { return false; }
}

export function thumbnailUrl(html: string, base: string): string | null {
  const images = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    if (attrs.get('content') && !images.has(key)) images.set(key, attrs.get('content')!);
  }
  for (const key of ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']) {
    try {
      if (!images.has(key)) continue;
      const url = new URL(images.get(key)!, base);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* Try the next metadata image. */ }
  }
  if (amazonPage(base)) {
    // Use Amazon's displayed product image, not its larger hi-res variant.
    for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
      const attrs = attributes(tag);
      if (attrs.get('id') !== 'landingImage' || !attrs.get('src')) continue;
      try {
        const url = new URL(attrs.get('src')!, base);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
      } catch { /* No usable product image. */ }
    }
  }
  return null;
}

export function registerLinkThumbnailRoute(app: FastifyInstance, fetcher = fetchPublic) {
  type Image = { data: Buffer; type: string };
  const cache = new Map<string, { until: number; image: Image | null }>();
  const pending = new Map<string, Promise<Image | null>>();
  const raster = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  async function load(url: string): Promise<Image | null> {
    const deadlineMs = performance.now() + 6000;
    const signal = AbortSignal.timeout(6000);
    async function read(destination: string, image: boolean) {
      const result = await fetcher(destination, { signal, deadlineMs, maxBytes: image || amazonPage(destination) ? 2 * 1024 * 1024 : 512 * 1024, oversize: image ? 'reject' : 'truncate' });
      try {
        const type = result.mediaType.split(';')[0].trim().toLowerCase();
        if (image ? !raster.has(type) : !['text/html', 'application/xhtml+xml'].includes(type)) throw Error('Unsupported media type');
        const chunks: Buffer[] = [];
        for await (const chunk of result.body) chunks.push(Buffer.from(chunk));
        return { data: Buffer.concat(chunks), type, url: result.finalUrl };
      } finally { result.close(); }
    }
    try {
      const page = await read(url, false);
      const image = thumbnailUrl(page.data.toString('utf8'), page.url);
      return image ? await read(image, true) : null;
    } catch { return null; }
  }
  app.get('/api/chat/link-thumbnail', async (request, reply) => {
    const raw = (request.query as { url?: unknown }).url;
    if (typeof raw !== 'string' || raw.length > 8192) return reply.code(400).send();
    let url: string;
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw Error();
      parsed.hash = '';
      url = parsed.href;
    } catch { return reply.code(400).send(); }
    const saved = cache.get(url);
    let image = saved && saved.until > Date.now() ? saved.image : undefined;
    if (image === undefined) {
      let task = pending.get(url);
      if (!task) {
        if (pending.size >= 4) return reply.code(429).send();
        task = load(url);
        pending.set(url, task);
      }
      image = await task;
      pending.delete(url);
      cache.delete(url);
      // At most 16 images of 2 MiB each, including negative results.
      while (cache.size >= 16) cache.delete(cache.keys().next().value!);
      cache.set(url, { image, until: Date.now() + 5 * 60_000 });
    }
    reply.header('Cache-Control', 'private, max-age=300').header('X-Content-Type-Options', 'nosniff');
    return image ? reply.type(image.type).send(image.data) : reply.code(404).send();
  });
}
