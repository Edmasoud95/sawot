import { useRef } from "react";
import { audioContext, meterFrom } from "../lib/audio";
import { levelBus } from "../lib/levelBus";

export function useRecorder(onUtterance) {
  const recorderRef = useRef(null);
  const sessionRef = useRef(0);

  async function start() {
    if (recorderRef.current) return; // already recording (e.g. second pointer)
    const session = ++sessionRef.current;
    const ctx = audioContext();
    await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (session !== sessionRef.current) {
      // released (or restarted) while we were waiting for the mic
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    meterFrom(ctx.createMediaStreamSource(stream));
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      levelBus.value = 0;
      const blob = new Blob(chunks, { type: "audio/webm" });
      if (blob.size > 0) onUtterance(await blob.arrayBuffer());
    };
    recorder.start();
    recorderRef.current = recorder;
  }

  function stop() {
    sessionRef.current++; // cancels any in-flight start
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
  }

  return { start, stop };
}
