import type { DictationRecorder } from "./dictation";

/** A private microphone/meter: dictation never touches voice playback or its level bus. */
export class BrowserDictationRecorder implements DictationRecorder {
  private generation = 0;
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private context: AudioContext | undefined;
  private frame = 0;
  private chunks: Blob[] = [];
  constructor(private level: (value: number) => void, private failed: () => void) {}

  async start() {
    this.cancel();
    const generation = this.generation;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      this.chunks = chunks;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { if (generation === this.generation) { this.cancel(); this.failed(); } };
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const meter = () => {
        if (generation !== this.generation) return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += (sample - 128) ** 2;
        this.level(Math.min(1, Math.sqrt(sum / samples.length) / 30));
        this.frame = requestAnimationFrame(meter);
      };
      recorder.start();
      meter();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (generation === this.generation) this.cancel();
      throw error;
    }
  }

  async stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording") { this.cancel(); return null; }
    const chunks = this.chunks;
    return new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.onerror = () => reject(new Error("Recording failed"));
      recorder.stop();
      this.release();
    });
  }

  private release() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.recorder = undefined;
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.level(0);
  }

  cancel() {
    this.generation++;
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.release();
  }
}
