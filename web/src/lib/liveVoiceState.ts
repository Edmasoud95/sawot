/** Silence is measured only while neither speaker nor delegated work is active. */
export class LiveIdleClock {
  private busy = false;
  constructor(private lastActivity: number) {}
  activity(now: number) { this.lastActivity = now; }
  setBusy(busy: boolean, now: number) {
    if (this.busy && !busy) this.activity(now);
    this.busy = busy;
  }
  expired(now: number) { return !this.busy && now - this.lastActivity >= 30_000; }
}

type Role = "user" | "assistant";
interface TranscriptTurn { role: Role; text: string; start: number; end: number }
export class LiveTranscript {
  private entries: TranscriptTurn[] = [];
  private latest: Partial<Record<Role, TranscriptTurn>> = {};
  append(role: Role, delta: string, start: number, end: number) {
    const previous = this.latest[role];
    if (previous && start >= previous.start && start - previous.end < 2000) {
      previous.text = (previous.text + delta).slice(-20_000);
      previous.end = Math.max(previous.end, end);
    } else {
      const entry = { role, text: delta.slice(-20_000), start, end };
      this.entries.push(entry);
      this.entries = this.entries.slice(-100);
      this.latest[role] = entry;
    }
  }
  caption(role: Role) { return this.latest[role]?.text ?? ""; }
  turns() { return this.entries.map(entry => ({ ...entry })); }
}
