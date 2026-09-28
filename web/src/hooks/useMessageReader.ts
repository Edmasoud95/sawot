import { useEffect, useMemo, useState } from "react";
import { MessageReader, type ReadingState } from "../lib/messageReader";
import { audioContext, playWav, stopPlayback } from "../lib/audio";
import { API_BASE } from "../lib/config";
import { useVoiceStore } from "../store";

export function useMessageReader(conversationId: string, streaming: boolean) {
  const [reading, setReading] = useState<ReadingState>(null);
  const mode = useVoiceStore(s => s.mode);
  const reader = useMemo(() => new MessageReader({
    unlock: () => audioContext().resume(),
    request: async (text, signal) => {
      const response = await fetch(`${API_BASE}/api/chat/speech`, {
        method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Speech is unavailable. Please try again.");
      }
      return response.arrayBuffer();
    },
    play: (audio, signal) => new Promise<void>((resolve, reject) => {
      const finish = () => { signal.removeEventListener("abort", finish); resolve(); };
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) { finish(); return; }
      void playWav(audio, finish).catch(error => { signal.removeEventListener("abort", finish); reject(error); });
    }),
    stop: stopPlayback,
  }, setReading), []);
  useEffect(() => () => reader.stop(), [reader, conversationId]);
  useEffect(() => { if (streaming || mode !== "chat") reader.stop(); }, [reader, streaming, mode]);
  return { reading, reader };
}
