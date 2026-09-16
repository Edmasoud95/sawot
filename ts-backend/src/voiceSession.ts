import type { HistoryMessage } from './agent.js';
import type { SendFn } from './pipeline.js';

/** Owns cancellation and committed conversation history for one connection. */
export class VoiceSession {
  private history: HistoryMessage[] = [];
  private active: AbortController | null = null;

  constructor(private send: (turnId: number, kind: string, payload: any) => void | Promise<void>) {}

  cancel() {
    this.active?.abort();
    this.active = null;
  }

  async start(turnId: number, run: (history: HistoryMessage[], send: SendFn, signal: AbortSignal) => Promise<void>) {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    // A provider or tool may finish despite cancellation. Its mutations must
    // never touch the history used by a subsequent request.
    const history = structuredClone(this.history);
    const send: SendFn = (kind, payload) => {
      if (this.active === controller && !controller.signal.aborted) return this.send(turnId, kind, payload);
    };
    try {
      await run(history, send, controller.signal);
      if (this.active === controller) this.history = history;
    } catch (error) {
      if (!controller.signal.aborted) await send('error', { message: String(error instanceof Error ? error.message : error) });
    }
  }
}
