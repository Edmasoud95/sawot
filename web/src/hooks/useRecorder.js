import { useRef } from "react";
import { audioContext, meterFrom } from "../lib/audio";
import { levelBus } from "../store";

export function useRecorder(onUtterance) {
  const recorderRef = useRef(null);

  async function start() {
    const ctx = audioContext();
    await ctx.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
  }

  return { start, stop };
}
