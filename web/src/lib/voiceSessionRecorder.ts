import { VoiceTurnDetector, encodeWav } from './voiceTurnDetector';
import { levelBus } from './levelBus';

interface Callbacks {
  context(): AudioContext;
  state(state: 'listening' | 'recording'): void;
  utterance(audio: ArrayBuffer): void;
  error(error: Error): void;
}
const loaded = new WeakMap<AudioContext, Promise<void>>();

/** Owns one microphone session. Reply audio and cancelled turns never enter its buffer. */
export class VoiceSessionRecorder {
  private generation = 0;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private context?: AudioContext;
  private detector?: VoiceTurnDetector;
  private listening = false;
  private acceptAfter = 0;
  private ready?: (ready: boolean) => void;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private readonly deviceLost = () => this.fail(new Error('Microphone disconnected. Tap to reconnect.'));
  private readonly contextChanged = () => {
    if (this.context?.state !== 'running') this.fail(new Error('Audio was interrupted. Tap to reconnect.'));
  };

  constructor(private callbacks: Callbacks) {}

  async start(): Promise<boolean> {
    this.end();
    const generation = this.generation;
    try {
      const context = this.callbacks.context();
      this.context = context;
      await context.resume();
      if (generation !== this.generation) return false;
      const stream = await navigator.mediaDevices.getUserMedia({audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1,
      }});
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
      this.stream = stream;
      for (const track of stream.getTracks()) {
        if (track.readyState === 'ended' || track.muted) throw new Error('Microphone is unavailable.');
        track.addEventListener('ended', this.deviceLost);
        track.addEventListener('mute', this.deviceLost);
      }
      if (!context.audioWorklet) throw new Error('Voice requires a browser with secure audio capture.');
      let module = loaded.get(context);
      if (!module) {
        module = context.audioWorklet.addModule(new URL('../worklets/voiceCapture.worklet.js', import.meta.url));
        loaded.set(context, module);
        module.catch(() => loaded.delete(context));
      }
      await module;
      if (generation !== this.generation) return false;
      this.detector = new VoiceTurnDetector(context.sampleRate);
      const node = new AudioWorkletNode(context, 'voice-capture');
      this.node = node;
      node.onprocessorerror = () => this.fail(new Error('Microphone capture stopped. Tap to reconnect.'));
      this.source = context.createMediaStreamSource(stream);
      // The processor produces silence; connecting its output keeps processing active.
      this.source.connect(node);
      node.connect(context.destination);
      context.addEventListener('statechange', this.contextChanged);
      const started = new Promise<boolean>(resolve => {
        this.ready = resolve;
        this.startupTimer = setTimeout(() => this.fail(new Error('No microphone audio arrived. Tap to try again.')), 8000);
      });
      node.port.onmessage = ({data}: MessageEvent<{samples: Float32Array; time: number}>) => {
        if (generation !== this.generation) return;
        if (this.ready) {
          clearTimeout(this.startupTimer);
          this.ready(true);
          this.ready = undefined;
        }
        if (!this.listening || data.time < this.acceptAfter) return;
        let energy = 0;
        for (const value of data.samples) energy += value * value;
        levelBus.microphone = Math.min(1, Math.sqrt(energy / data.samples.length) * 8);
        const speaking = this.detector!.speaking;
        const turn = this.detector!.push(data.samples);
        if (turn) this.deliver(turn);
        else if (!speaking && this.detector!.speaking) this.callbacks.state('recording');
      };
      return await started;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.end();
      throw error;
    }
  }

  listen() {
    if (!this.stream || !this.detector || this.ready) return;
    this.detector.reset();
    this.acceptAfter = this.context!.currentTime;
    this.listening = true;
    this.callbacks.state('listening');
  }

  pause() {
    this.listening = false;
    this.detector?.reset();
    levelBus.microphone = 0;
  }

  send() {
    if (!this.listening) return;
    const turn = this.detector?.finish();
    if (turn) this.deliver(turn);
  }

  private deliver(frames: Float32Array[]) {
    this.pause();
    this.callbacks.utterance(encodeWav(frames, this.context!.sampleRate));
  }

  private fail(error: Error) {
    this.end();
    this.callbacks.error(error);
  }

  end() {
    this.generation++;
    this.pause();
    clearTimeout(this.startupTimer);
    this.ready?.(false);
    this.ready = undefined;
    this.context?.removeEventListener('statechange', this.contextChanged);
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      this.node.port.close();
      this.node.disconnect();
    }
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('ended', this.deviceLost);
      track.removeEventListener('mute', this.deviceLost);
      track.stop();
    }
    this.stream = this.source = this.node = this.context = this.detector = undefined;
  }
}
