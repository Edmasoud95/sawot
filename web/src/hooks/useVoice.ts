import { useEffect, useRef } from "react";
import { VoiceSocket } from "../lib/socket";
import { playWav } from "../lib/audio";
import { useRecorder } from "./useRecorder";
import { useDebugStore } from "../debugStore";
import { useVoiceStore } from "../store";
import { useChatStore } from "../chatStore";

export function useVoice() {
  const socketRef = useRef(null);
  const debugTurnRef = useRef<number | null>(null);

  const finishDebug = (outcome: "completed" | "failed", error?: string, id = debugTurnRef.current) => {
    if (id !== null) useDebugStore.getState().finishTurn(id, outcome, error);
  };

  useEffect(() => {
    const socket = new VoiceSocket({
      onOpen: () => useVoiceStore.getState().setStatus("idle"),
      onClose: () => {
        finishDebug("failed", "Voice connection closed");
        debugTurnRef.current = null;
        useVoiceStore.getState().setStatus("connecting");
      },
      onEvent: (msg) => {
        const s = useVoiceStore.getState();
        if (s.debugEnabled) {
          const d = useDebugStore.getState();
          d.logMessage("in", msg);
          if (msg.type === "debug") {
            if (debugTurnRef.current === null) debugTurnRef.current = d.beginTurn("voice");
            d.addEvent(msg, debugTurnRef.current);
          }
        }
        if (msg.type === "reading") {
          s.showReading(msg);
        } else if (msg.type === "expression") {
          s.showExpression(msg);
        } else if (msg.type === "activity") {
          s.showActivity(msg);
        } else if (msg.type === "search") {
          s.showSearch(msg);
        } else if (msg.type === "debug") {
          s.addDebugEvent(msg);
        } else if (msg.type === "transcript") {
          s.setUserCaption(msg.text);
          const { traces } = useVoiceStore.getState();
          s.addTurn("user", msg.text, traces.length ? traces[traces.length - 1].id : null);
          s.setStatus("thinking");
        } else if (msg.type === "assistant_text") {
          s.setAssistantCaption(msg.text);
          s.addTurn("assistant", msg.text);
        } else if (msg.type === "entities") {
          s.setCards(msg.entities);
          // Keep inline chat cards in sync with control refreshes.
          useChatStore.getState().patchCards(msg.entities);
        } else if (msg.type === "error") {
          if (msg.source !== "control") finishDebug("failed", msg.message);
          s.clearSearch();
          s.clearExpression();
          s.setAssistantCaption(msg.message);
          s.setStatus("idle");
        }
      },
      onAudio: (buf) => {
        const debugTurn = debugTurnRef.current;
        if (useVoiceStore.getState().debugEnabled) useDebugStore.getState().logMessage("in", `audio ${buf.byteLength} bytes`);
        useVoiceStore.getState().setStatus("speaking");
        playWav(buf, () => {
          finishDebug("completed", undefined, debugTurn);
          useVoiceStore.getState().setStatus("idle");
        }).catch(() => {
          finishDebug("failed", "Audio playback failed", debugTurn);
          useVoiceStore.getState().clearSearch();
          useVoiceStore.getState().clearExpression();
          useVoiceStore.getState().setStatus("idle");
        });
      },
    });
    socketRef.current = socket;
    return () => socket.close(); // StrictMode-safe: no reconnect after close()
  }, []);

  const recorder = useRecorder((arrayBuffer) => {
    debugTurnRef.current = useVoiceStore.getState().debugEnabled
      ? useDebugStore.getState().beginTurn("voice") : null;
    if (!socketRef.current?.ready) {
      finishDebug("failed", "Voice connection closed before audio could be sent");
      useVoiceStore.getState().setStatus("connecting");
      return;
    }
    useVoiceStore.getState().setStatus("thinking");
    try {
      socketRef.current.sendAudio(arrayBuffer);
    } catch {
      finishDebug("failed", "Could not send recorded audio");
      useVoiceStore.getState().setStatus("connecting");
    }
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
    sendControl: (message) => {
      if (useVoiceStore.getState().debugEnabled) useDebugStore.getState().logMessage("out", message);
      socketRef.current?.sendControl(message);
    },
  };
}
