import { useEffect, useRef } from "react";
import { VoiceSocket } from "../lib/socket";
import { audioContext, playReadyCue, playWav, stopPlayback } from "../lib/audio";
import { VoiceSessionRecorder } from "../lib/voiceSessionRecorder";
import { useDebugStore } from "../debugStore";
import { useVoiceStore } from "../store";
import { useChatStore } from "../chatStore";
import { useVoicePictures, type VoicePicture } from "./useVoicePictures";

export function useVoice() {
  const socketRef = useRef(null);
  const interactionRef = useRef(0);
  const debugTurnRef = useRef<number | null>(null);
  const pictures = useVoicePictures();
  const sentPictures = useRef<VoicePicture[]>([]);
  const recordingPictures = useRef<VoicePicture[]>([]);
  const sessionRef = useRef(false);
  const recorderRef = useRef<VoiceSessionRecorder | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finishDebug = (outcome: "completed" | "failed" | "cancelled", error?: string, id = debugTurnRef.current) => {
    if (id !== null) useDebugStore.getState().finishTurn(id, outcome, error);
  };

  useEffect(() => {
    const socket = new VoiceSocket({
      onOpen: () => useVoiceStore.getState().setStatus("idle"),
      onClose: () => {
        finishDebug("failed", "Voice connection closed");
        debugTurnRef.current = null;
        endSession();
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
          s.addTurn("user", msg.text, traces.length ? traces[traces.length - 1].id : null,
            sentPictures.current.map(({ id, name }) => ({ id, name })));
          s.setStatus("thinking");
        } else if (msg.type === "assistant_text") {
          s.setAssistantCaption(msg.text);
          s.addTurn("assistant", msg.text);
        } else if (msg.type === "entities") {
          s.setCards(msg.entities);
          // Keep inline chat cards in sync with control refreshes.
          useChatStore.getState().patchCards(msg.entities);
        } else if (msg.type === "error") {
          if (msg.source === "control") { s.setAssistantCaption(msg.message); return; }
          finishDebug("failed", msg.message);
          debugTurnRef.current = null;
          endSession();
          s.clearSearch();
          s.clearExpression();
          s.setAssistantCaption(msg.message);
          s.setStatus("idle");
        }
      },
      onAudio: (buf) => {
        recorderRef.current?.end();
        // Keep pictures available if synthesis fails or the turn is interrupted
        // after its text arrives but before its history is committed.
        pictures.remove(sentPictures.current.map(p => p.key));
        sentPictures.current = [];
        const interaction = interactionRef.current;
        const debugTurn = debugTurnRef.current;
        if (useVoiceStore.getState().debugEnabled) useDebugStore.getState().logMessage("in", `audio ${buf.byteLength} bytes`);
        useVoiceStore.getState().setStatus("speaking");
        playWav(buf, () => {
          if (interaction !== interactionRef.current) return;
          finishDebug("completed", undefined, debugTurn);
          debugTurnRef.current = null;
          if (sessionRef.current) {
            // Let the speaker's short acoustic tail fade before accepting a new turn.
            resumeTimer.current = setTimeout(() => {
              if (interaction === interactionRef.current) resumeListening();
            }, 220);
          } else useVoiceStore.getState().setStatus("idle");
        }).catch(() => {
          if (interaction !== interactionRef.current) return;
          finishDebug("failed", "Audio playback failed", debugTurn);
          debugTurnRef.current = null;
          endSession();
          useVoiceStore.getState().setAssistantCaption("Couldn't play the reply. Tap to reconnect.");
          useVoiceStore.getState().clearSearch();
          useVoiceStore.getState().clearExpression();
          useVoiceStore.getState().setStatus("idle");
        });
      },
    });
    socketRef.current = socket;
    return () => { endSession(); socket.close(); };
  }, []);

  async function resumeListening() {
    if (!sessionRef.current || !socketRef.current?.ready) return;
    const interaction = interactionRef.current;
    const s = useVoiceStore.getState();
    s.setStatus("starting");
    try {
      const ready = await recorderRef.current!.start();
      if (!ready || interaction !== interactionRef.current || !sessionRef.current) return;
      recordingPictures.current = [...pictures.current.current];
      recorderRef.current!.listen();
      playReadyCue();
    } catch {
      if (interaction !== interactionRef.current) return;
      endSession();
      s.setAssistantCaption("Couldn't start the microphone. Check permissions and try again.");
    }
  }

  function cancelTurn() {
    interactionRef.current++;
    clearTimeout(resumeTimer.current);
    stopPlayback();
    recorderRef.current?.pause();
    socketRef.current?.cancelTurn();
    finishDebug("cancelled");
    debugTurnRef.current = null;
    const s = useVoiceStore.getState();
    s.beginResponse();
    s.clearExpression();
  }

  function endSession() {
    sessionRef.current = false;
    cancelTurn();
    recorderRef.current?.end();
    const s = useVoiceStore.getState();
    s.setSessionActive(false);
    s.setStatus(socketRef.current?.ready ? "idle" : "connecting");
  }

  if (!recorderRef.current) recorderRef.current = new VoiceSessionRecorder({
    context: audioContext,
    state: status => {
      if (!sessionRef.current) return;
      const s = useVoiceStore.getState();
      if (status === "recording") s.beginResponse();
      s.setStatus(status);
    },
    utterance: arrayBuffer => {
      if (!sessionRef.current) return;
      // Pausing sample processing leaves capture active and can retain phone-call
      // audio routing. Release the actual tracks before reply playback, then
      // reacquire automatically when the next listening turn starts.
      recorderRef.current?.end();
      if (!socketRef.current?.ready) { endSession(); return; }
      const s = useVoiceStore.getState();
      debugTurnRef.current = s.debugEnabled ? useDebugStore.getState().beginTurn("voice") : null;
      s.setStatus("thinking");
      try {
        sentPictures.current = recordingPictures.current;
        socketRef.current.sendAudio(arrayBuffer, sentPictures.current.map(p => p.id));
      } catch {
        finishDebug("failed", "Could not send recorded audio");
        debugTurnRef.current = null;
        endSession();
        s.setAssistantCaption("Couldn't send audio. Tap to reconnect.");
      }
    },
    error: error => {
      endSession();
      useVoiceStore.getState().setAssistantCaption(error.message);
    },
  });

  async function startSession() {
    const s = useVoiceStore.getState();
    if (!socketRef.current?.ready || sessionRef.current || pictures.current.current.some(p => p.uploading)) return;
    cancelTurn();
    sessionRef.current = true;
    s.setSessionActive(true);
    s.beginResponse();
    await resumeListening();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if ((event.target as HTMLElement)?.closest?.('[role="dialog"]') || document.querySelector('dialog[open], :popover-open')) return;
      const status = useVoiceStore.getState().status;
      if (!["thinking", "speaking", "starting", "listening", "recording"].includes(status)) return;
      event.preventDefault();
      endSession();
    };
    const onHidden = () => { if (document.hidden) endSession(); };
    const unsubscribe = useVoiceStore.subscribe((state, previous) => {
      if (state.mode === "chat" && previous.mode !== "chat") endSession();
    });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", endSession);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", endSession);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  return {
    pictures,
    sendPictures: () => {
      const selected = pictures.current.current;
      if (!socketRef.current?.ready || !selected.length || selected.some(p => p.uploading)) return;
      endSession();
      const s = useVoiceStore.getState();
      s.beginResponse();
      sentPictures.current = [...selected];
      debugTurnRef.current = s.debugEnabled ? useDebugStore.getState().beginTurn("voice") : null;
      try {
        socketRef.current.sendImages(selected.map(p => p.id));
        s.setStatus("thinking");
      } catch {
        finishDebug("failed", "Could not send pictures");
        s.setStatus("connecting");
      }
    },
    endSession,
    tapMicrophone: async () => {
      const status = useVoiceStore.getState().status;
      if (status === "starting") { endSession(); return; }
      if (status === "listening" || status === "recording") { recorderRef.current?.send(); return; }
      if (status === "thinking" || status === "speaking") {
        cancelTurn();
        if (sessionRef.current) { await resumeListening(); return; }
      }
      await startSession();
    },
    sendControl: (message) => {
      if (useVoiceStore.getState().debugEnabled) useDebugStore.getState().logMessage("out", message);
      socketRef.current?.sendControl(message);
    },
  };
}
