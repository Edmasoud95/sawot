export type ReadingState = { key: string; phase: "loading" | "playing" | "error"; error?: string } | null;
export interface ReaderDependencies {
  unlock: () => Promise<void>;
  request: (text: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  play: (audio: ArrayBuffer, signal: AbortSignal) => Promise<void>;
  stop: () => void;
}

/** Bound synthesis work and start long messages without waiting for all audio. */
export function speechChunks(text: string): string[] {
  let remaining = text.trim();
  const chunks: string[] = [];
  while (remaining.length > 600) {
    const head = remaining.slice(0, 600);
    const boundary = [...head.matchAll(/[.!?](?=\s)|\n/g)].pop();
    let end = boundary ? boundary.index! + 1 : head.lastIndexOf(" ");
    if (end < 1) end = 600;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class MessageReader {
  private active: { key: string; controller: AbortController } | null = null;
  constructor(private deps: ReaderDependencies, private changed: (state: ReadingState) => void) {}
  stop() {
    if (this.active) {
      this.active.controller.abort();
      this.deps.stop();
      this.active = null;
    }
    this.changed(null);
  }
  async toggle(key: string, text: string) {
    if (this.active?.key === key) { this.stop(); return; }
    this.stop();
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const current = { key, controller: new AbortController() };
    this.active = current;
    const signal = current.controller.signal;
    this.changed({ key, phase: "loading" });
    try {
      // Called in the click handler, before network waits lose user activation.
      await this.deps.unlock();
      signal.throwIfAborted();
      for (const [index, chunk] of chunks.entries()) {
        if (index > 0) this.changed({ key, phase: "loading" });
        const audio = await this.deps.request(chunk, signal);
        signal.throwIfAborted();
        this.changed({ key, phase: "playing" });
        await this.deps.play(audio, signal);
        signal.throwIfAborted();
      }
      this.active = null;
      this.changed(null);
    } catch (error) {
      if (signal.aborted || this.active !== current) return;
      this.deps.stop();
      this.active = null;
      this.changed({ key, phase: "error", error: error instanceof Error ? error.message : "Could not read this message." });
    }
  }
}
