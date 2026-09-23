export type DictationMode = "idle" | "latched" | "transcribing";
export interface DictationState { mode: DictationMode; ready: boolean; error: string }
export interface DictationRecorder {
  start(): Promise<void>;
  stop(): Promise<Blob | null>;
  cancel(): void;
}

/** Owns click-to-toggle recording and rejects work from cancelled sessions. */
export class DictationController {
  state: DictationState = { mode: "idle", ready: false, error: "" };
  private generation = 0;
  private request: AbortController | undefined;
  constructor(private options: {
    recorder: DictationRecorder;
    transcribe(audio: Blob, signal: AbortSignal): Promise<string>;
    onText(text: string): void;
    onChange(state: DictationState): void;
  }) {}

  private update(patch: Partial<DictationState>) {
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  private begin() {
    const generation = ++this.generation;
    this.update({ mode: "latched", ready: false, error: "" });
    void this.options.recorder.start().then(() => {
      if (generation === this.generation) this.update({ ready: true });
    }).catch(error => {
      if (generation !== this.generation) return;
      this.cancel(error?.name === "NotAllowedError"
        ? "Allow microphone permission to dictate."
        : "Could not start the microphone. Check that it is available.");
    });
  }

  toggle() {
    if (this.state.mode === "idle") this.begin();
    else if (this.state.mode === "latched") void this.finish();
  }

  async finish() {
    if (this.state.mode === "idle" || this.state.mode === "transcribing") return;
    if (!this.state.ready) { this.cancel(); return; }
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    this.update({ mode: "transcribing", ready: false });
    try {
      const audio = await this.options.recorder.stop();
      if (generation !== this.generation) return;
      const text = audio?.size ? (await this.options.transcribe(audio, request.signal)).trim() : "";
      if (generation !== this.generation) return;
      if (text) this.options.onText(text);
      this.update({ mode: "idle", error: text ? "" : "No speech detected. Try again." });
    } catch {
      if (generation === this.generation) this.update({ mode: "idle", error: "Could not transcribe. Please try again." });
    } finally {
      if (generation === this.generation) this.request = undefined;
    }
  }

  cancel(error = "") {
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    this.options.recorder.cancel();
    this.update({ mode: "idle", ready: false, error });
  }
}
