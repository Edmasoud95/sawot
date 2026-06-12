import { useEffect, useRef } from "react";
import { VoiceSocket } from "../lib/socket";
import { playWav } from "../lib/audio";
import { useRecorder } from "./useRecorder";
import { useVoiceStore } from "../store";

export function useVoice() {
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = new VoiceSocket({
      onOpen: () => useVoiceStore.getState().setStatus("idle"),
      onClose: () => useVoiceStore.getState().setStatus("connecting"),
      onEvent: (msg) => {
        const s = useVoiceStore.getState();
        if (msg.type === "debug") {
          s.addDebugEvent(msg);
        } else if (msg.type === "transcript") {
          s.setUserCaption(msg.text);
          const { traces } = useVoiceStore.getState();
          s.addTurn("user", msg.text, traces.length ? traces[traces.length - 1].id : null);
          s.setStatus("thinking");
        } else if (msg.type === "assistant_text") {
          s.setAssistantCaption(msg.text);
          s.addTurn("assistant", msg.text);
        } else if (msg.type === "error") {
          s.setAssistantCaption(msg.message);
          s.setStatus("idle");
        }
      },
      onAudio: (buf) => {
        useVoiceStore.getState().setStatus("speaking");
        playWav(buf, () => useVoiceStore.getState().setStatus("idle")).catch(() =>
          useVoiceStore.getState().setStatus("idle")
        );
      },
    });
    socketRef.current = socket;
    return () => socket.close(); // StrictMode-safe: no reconnect after close()
  }, []);

  const recorder = useRecorder((arrayBuffer) => {
    useVoiceStore.getState().setStatus("thinking");
    socketRef.current.sendAudio(arrayBuffer);
  });

  return {
    startTalking: async () => {
      const s = useVoiceStore.getState();
      if (!socketRef.current?.ready || s.status === "speaking") return;
      s.clearCaptions();
      s.setStatus("recording");
      try {
        await recorder.start();
      } catch {
        s.setAssistantCaption("Microphone unavailable — check permissions.");
        s.setStatus("idle");
      }
    },
    stopTalking: () => {
      recorder.stop();
      const s = useVoiceStore.getState();
      if (s.status === "recording") s.setStatus("idle");
    },
  };
}
