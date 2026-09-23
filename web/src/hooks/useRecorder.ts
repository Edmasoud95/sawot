import { useEffect, useRef } from "react";
import { audioContext, meterFrom } from "../lib/audio";
import { levelBus } from "../lib/levelBus";

export function useRecorder(onUtterance) {
  const recorderRef = useRef(null);
  const sessionRef = useRef(0);
  const deliveryRef = useRef(0);
  const pendingStartRef = useRef<((ready: boolean) => void) | null>(null);

  async function start() {
    if (recorderRef.current) return false; // already recording (e.g. second pointer)
    const session = ++sessionRef.current;
    const delivery = ++deliveryRef.current;
    const ctx = audioContext();
    await ctx.resume();
    if (session !== sessionRef.current) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (session !== sessionRef.current) {
      // released (or restarted) while we were waiting for the mic
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    try {
      meterFrom(ctx.createMediaStreamSource(stream));
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (delivery === deliveryRef.current) levelBus.value = 0;
        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size > 0) {
          const buffer = await blob.arrayBuffer();
          if (delivery === deliveryRef.current) onUtterance(buffer);
        }
      };
      recorderRef.current = recorder;
      return await new Promise<boolean>((resolve, reject) => {
        pendingStartRef.current = resolve;
        recorder.onstart = () => {
          if (session !== sessionRef.current) return;
          pendingStartRef.current = null;
          resolve(true);
        };
        recorder.onerror = () => reject(new Error("Microphone recording failed"));
        recorder.start();
      });
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      if (session === sessionRef.current) {
        pendingStartRef.current = null;
        recorderRef.current = null;
        deliveryRef.current++;
        levelBus.value = 0;
      }
      throw error;
    }
  }

  function stop() {
    sessionRef.current++; // cancels any in-flight start
    pendingStartRef.current?.(false);
    pendingStartRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
  }

  function cancel() {
    deliveryRef.current++;
    stop();
  }

  useEffect(() => () => cancel(), []);
  return { start, stop, cancel };
}
