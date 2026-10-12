import type { ServerResponse } from 'node:http';

/** A turn owns generation; HTTP viewers only subscribe to its output. */
export class ChatStream {
  private viewers = new Map<ServerResponse, () => void>();

  attach(raw: ServerResponse, snapshot?: unknown) {
    if (raw.destroyed || raw.writableEnded) return;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    const heartbeat = setInterval(() => this.write(raw, ': heartbeat\n\n'), 15000);
    heartbeat.unref();
    const cleanup = () => { clearInterval(heartbeat); this.viewers.delete(raw); raw.off('close', cleanup); };
    this.viewers.set(raw, cleanup);
    raw.once('close', cleanup);
    // Snapshot and subscription happen synchronously: no missed or replayed deltas.
    if (snapshot) this.write(raw, `data: ${JSON.stringify(snapshot)}\n\n`);
    else raw.flushHeaders(); // A long model warm-up must not look like a failed connection.
  }

  private write(raw: ServerResponse, data: string) {
    if (raw.destroyed || raw.writableEnded) { this.viewers.get(raw)?.(); return; }
    // A suspended reader must not grow an unbounded queue or slow generation.
    if (raw.writableLength > 1024 * 1024) { raw.destroy(); this.viewers.get(raw)?.(); return; }
    raw.write(data);
  }

  emit(event: unknown) {
    if (!this.viewers.size) return;
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const raw of this.viewers.keys()) this.write(raw, data);
  }

  end() {
    for (const [raw, cleanup] of this.viewers) { cleanup(); if (!raw.destroyed) raw.end(); }
    this.viewers.clear();
  }
}
