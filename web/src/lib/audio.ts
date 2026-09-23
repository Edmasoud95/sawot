import { levelBus } from "./levelBus";

let ctx, analyser, data;
let currentSource = null;

export function audioContext() {
  if (!ctx) {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    data = new Uint8Array(analyser.frequencyBinCount);
    (function pump() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += (v - 128) ** 2;
      levelBus.value = Math.min(1, Math.sqrt(sum / data.length) / 28);
      requestAnimationFrame(pump);
    })();
  }
  return ctx;
}

/** Route a node into the level analyser (mic while recording, reply while speaking). */
export function meterFrom(node) {
  if (currentSource) currentSource.disconnect();
  currentSource = node;
  node.connect(analyser);
}

let activePlayback = null;
let activeCue: OscillatorNode | null = null;

/** A soft two-note lift marks actual microphone readiness, away from the thumb. */
export function playReadyCue() {
  if (activeCue) { try { activeCue.stop(); } catch {} }
  const context = audioContext();
  const tone = context.createOscillator();
  const gain = context.createGain();
  activeCue = tone;
  const now = context.currentTime;
  tone.type = "sine";
  tone.frequency.setValueAtTime(660, now);
  tone.frequency.exponentialRampToValueAtTime(880, now + .07);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(.035, now + .015);
  gain.gain.exponentialRampToValueAtTime(.0001, now + .1);
  tone.connect(gain);
  gain.connect(context.destination);
  tone.onended = () => { tone.disconnect(); gain.disconnect(); if (activeCue === tone) activeCue = null; };
  tone.start(now);
  tone.stop(now + .11);
}

let playbackEpoch = 0;

export function stopPlayback() {
  if (activeCue) { try { activeCue.stop(); } catch {} activeCue = null; }
  playbackEpoch++;
  const source = activePlayback;
  activePlayback = null;
  if (source) {
    source.onended = null;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    if (currentSource === source) currentSource = null;
  }
  levelBus.value = 0;
}

export async function playWav(arrayBuffer, onEnded) {
  stopPlayback();
  const epoch = playbackEpoch;
  const context = audioContext();
  let buffer;
  try {
    await context.resume();
    if (epoch !== playbackEpoch) return;
    buffer = await context.decodeAudioData(arrayBuffer.slice(0));
  } catch (error) {
    if (epoch !== playbackEpoch) return;
    throw error;
  }
  if (epoch !== playbackEpoch) return;
  const source = context.createBufferSource();
  activePlayback = source;
  source.buffer = buffer;
  meterFrom(source);
  source.connect(context.destination);
  source.onended = () => {
    if (epoch !== playbackEpoch || activePlayback !== source) return;
    activePlayback = null;
    source.disconnect();
    if (currentSource === source) currentSource = null;
    levelBus.value = 0;
    onEnded();
  };
  source.start();
}
