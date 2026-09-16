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

let playbackEpoch = 0;

export function stopPlayback() {
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
