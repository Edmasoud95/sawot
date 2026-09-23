/** Local sound-activity endpointing. Timing uses captured samples, not UI timers. */
export class VoiceTurnDetector {
  speaking = false;
  private prefix: Float32Array[] = [];
  private prefixSamples = 0;
  private frames: Float32Array[] = [];
  private candidateMs = 0;
  private quietMs = 0;
  private candidateGapMs = 0;
  private durationMs = 0;
  private noise = .003;
  private manualFrames: Float32Array[] | null = null;
  private manualQuietMs = 0;
  private manualSamples = 0;

  constructor(private sampleRate: number) {}

  push(frame: Float32Array): Float32Array[] | null {
    const ms = frame.length / this.sampleRate * 1000;
    let energy = 0;
    for (const value of frame) energy += value * value;
    const rms = Math.sqrt(energy / frame.length);
    const active = rms > Math.max(.012, this.noise * 3);
    if (!this.speaking) {
      this.prefix.push(frame);
      this.prefixSamples += frame.length;
      while (this.prefixSamples > this.sampleRate * .4 && this.prefix.length > 1) {
        this.prefixSamples -= this.prefix.shift()!.length;
      }
      // Estimate quiet background only; never train the threshold on speech.
      if (!active) this.noise = this.noise * .98 + Math.min(rms, .02) * .02;
      // A short word can be manually sent after the user's finger reaches the
      // button. Keep that bounded candidate independently of onset detection.
      if (this.manualFrames) {
        this.manualFrames.push(frame);
        this.manualSamples += frame.length;
        while (this.manualSamples > this.sampleRate * 1.8 && this.manualFrames.length > 1) {
          this.manualSamples -= this.manualFrames.shift()!.length;
        }
        this.manualQuietMs = active ? 0 : this.manualQuietMs + ms;
        if (this.manualQuietMs >= 1400) this.manualFrames = null;
      }
      // Unvoiced consonants and tiny pauses must not erase preceding syllables.
      this.candidateGapMs = active ? 0 : this.candidateGapMs + ms;
      if (active) this.candidateMs += ms;
      else if (this.candidateGapMs >= 220) this.candidateMs = 0;
      if (this.candidateMs >= 80 && !this.manualFrames) {
        this.manualFrames = [...this.prefix];
        this.manualSamples = this.prefixSamples;
        this.manualQuietMs = 0;
      }
      if (this.candidateMs < 120) return null;
      this.manualFrames = null;
      this.speaking = true;
      this.frames = this.prefix;
      this.prefix = [];
      this.durationMs = this.prefixSamples / this.sampleRate * 1000;
      this.prefixSamples = 0;
    } else {
      this.frames.push(frame);
      this.durationMs += ms;
    }
    this.quietMs = active ? 0 : this.quietMs + ms;
    return this.quietMs >= 1400 || this.durationMs >= 45000 ? this.finish() : null;
  }

  finish(): Float32Array[] | null {
    const result = this.speaking ? this.frames : this.manualFrames;
    this.reset();
    return result;
  }

  reset() {
    this.speaking = false;
    this.prefix = [];
    this.prefixSamples = 0;
    this.frames = [];
    this.manualFrames = null;
    this.manualQuietMs = this.manualSamples = 0;
    this.candidateMs = this.candidateGapMs = this.quietMs = this.durationMs = 0;
  }
}

export function encodeWav(frames: Float32Array[], sampleRate: number): ArrayBuffer {
  const samples = frames.reduce((sum, frame) => sum + frame.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const frame of frames) for (const value of frame) {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    offset += 2;
  }
  return buffer;
}
