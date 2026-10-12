/** Only Brave-supplied image proxies can be used as direct thumbnail hints.
 * The actual download still goes through publicFetch's DNS/redirect checks. */
export function searchThumbnail(value: unknown): string | undefined {
  try {
    if (typeof value !== 'string' || value.length > 4096) return;
    const url = new URL(value);
    if (url.origin !== 'https://imgs.search.brave.com' || url.username || url.password) return;
    url.hash = '';
    return url.href;
  } catch { return; }
}
