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

export async function playWav(arrayBuffer, onEnded) {
  const context = audioContext();
  await context.resume();
  const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
  if (activePlayback) {
    activePlayback.onended = null;
    try {
      activePlayback.stop();
    } catch {
      /* already stopped */
    }
  }
  const source = context.createBufferSource();
  activePlayback = source;
  source.buffer = buffer;
  meterFrom(source);
  source.connect(context.destination);
  source.onended = () => {
    if (activePlayback === source) activePlayback = null;
    levelBus.value = 0;
    onEnded();
  };
  source.start();
}
