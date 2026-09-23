import { SettingsStore } from './settingsStore.js';

/** A server base URL, with no credentials or per-request parameters. */
export function normalizeHaUrl(value: unknown): string {
  const message = 'Home Assistant URL must be an http:// or https:// address without a username, password, query, or fragment.';
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(message);
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (!/^https?:\/\//i.test(trimmed) || /\s|\\/.test(trimmed) || !url.hostname || url.username || url.password || url.search || url.hash || /[?#]/.test(trimmed)) throw new Error();
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error(message);
  }
}

export function migrateHaUrl(store: SettingsStore, legacy: unknown): string {
  const saved = store.load();
  if (Object.hasOwn(saved, 'haUrl')) return normalizeHaUrl(saved.haUrl);
  const url = normalizeHaUrl(legacy ?? '');
  if (url) store.save({ haUrl: url });
  return url;
}
