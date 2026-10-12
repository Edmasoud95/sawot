import { createHash } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, writeFile, rename, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';

export const rasterTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
export type Thumbnail = { data: Buffer; type: string };
export interface ThumbnailCacheOptions { cacheDir?: string; maxBytes?: number }
const TTL = 7 * 86400_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Disposable image bytes only. URLs/provenance belong to saved chat sources.
 * mtime is download time (expiry), atime is explicit last use (eviction).
 * Serial disk operations keep concurrent downloads within the size limit. */
export class ThumbnailCache {
  private tail: Promise<unknown> = Promise.resolve();
  private lastUse = 0;
  constructor(private directory: string, private maxBytes = 100 * 1024 * 1024) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
  private path(key: string) { return join(this.directory, createHash('sha256').update(key).digest('hex') + '.thumb'); }
  private accessTime() { return new Date(this.lastUse = Math.max(Date.now(), this.lastUse + 1)); }

  private async prune(reserve = 0) {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const entries: {path: string; size: number; used: number}[] = [];
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.(thumb|tmp)$/.test(name)) continue;
      const path = join(this.directory, name);
      const info = await lstat(path);
      if (!info.isFile() || name.endsWith('.tmp') || info.mtimeMs + TTL <= Date.now() || info.size > MAX_IMAGE_BYTES + 1) {
        await unlink(path); continue;
      }
      entries.push({path, size: info.size, used: info.atimeMs});
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a,b) => a.used - b.used || a.path.localeCompare(b.path))) {
      if (total + reserve <= this.maxBytes) break;
      await unlink(entry.path); total -= entry.size;
    }
  }
  sweep() { return this.serial(() => this.prune()); }

  get(key: string): Promise<Thumbnail | undefined> {
    return this.serial(async () => {
      const path = this.path(key);
      let info;
      try { info = await lstat(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (!info.isFile() || info.mtimeMs + TTL <= Date.now() || info.size > MAX_IMAGE_BYTES + 1) { await unlink(path); return; }
      const bytes = await readFile(path);
      const type = rasterTypes[bytes[0]];
      if (!type || bytes.length < 2) { await unlink(path); return; }
      await utimes(path, this.accessTime(), info.mtime);
      return {type, data: bytes.subarray(1)};
    });
  }
  put(key: string, image: Thumbnail) {
    return this.serial(async () => {
      const type = rasterTypes.indexOf(image.type);
      if (type < 0 || !image.data.length || image.data.length > MAX_IMAGE_BYTES || image.data.length + 1 > this.maxBytes) return;
      const path = this.path(key);
      await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await this.prune(image.data.length + 1);
      const temporary = path.replace(/\.thumb$/, '.tmp');
      try {
        await writeFile(temporary, Buffer.concat([Buffer.from([type]), image.data]), {mode: 0o600});
        await rename(temporary, path);
        await utimes(path, this.accessTime(), new Date());
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
}
