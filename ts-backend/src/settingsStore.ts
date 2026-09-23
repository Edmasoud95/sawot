import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Shared with the speech sidecar. Never discard unreadable settings. */
export class SettingsStore {
  constructor(private path: string) {}

  load(): Record<string, any> {
    if (!existsSync(this.path)) return {};
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data;
    } catch {
      // Parser errors can quote credentials from malformed JSON.
      throw new Error('Cannot read settings.json; restore or repair the file before continuing.');
    }
  }

  save(data: Record<string, any>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const lock = this.path + ".lock";
    const deadline = Date.now() + 5000;
    while (true) {
      try { mkdirSync(lock, { mode: 0o700 }); break; }
      catch (error: any) {
        if (error.code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new Error("Settings are busy. Retry; if this persists, stop SAWOT and remove settings.json.lock.");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    try {
      // Both processes hold this lock across the entire read/merge/write.
      const merged = { ...this.load(), ...data };
      writeFileSync(temporary, JSON.stringify(merged, null, 2), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

export const CREDENTIAL_KEYS = ['haToken', 'braveApiKey', 'hfToken'] as const;
export type Credentials = Record<typeof CREDENTIAL_KEYS[number], string>;

/** Empty saved values are deliberate removals, not migration candidates. */
export function migrateCredentials(store: SettingsStore, legacy: Credentials): Credentials {
  const saved = store.load();
  const patch: Partial<Credentials> = {};
  for (const key of CREDENTIAL_KEYS) {
    if (!Object.hasOwn(saved, key) && legacy[key]) patch[key] = legacy[key].trim();
    if (Object.hasOwn(saved, key) && typeof saved[key] !== 'string') {
      throw new Error('Invalid credential setting: ' + key);
    }
  }
  if (Object.keys(patch).length) store.save(patch);
  return { haToken: saved.haToken ?? patch.haToken ?? '', braveApiKey: saved.braveApiKey ?? patch.braveApiKey ?? '', hfToken: saved.hfToken ?? patch.hfToken ?? '' };
}
