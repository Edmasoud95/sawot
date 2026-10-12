import { useEffect, useRef } from "react";
import { LiveVoiceSession } from "../lib/liveVoiceSession";
import { levelBus, useVoiceStore } from "../store";

export function useLiveVoice(enabled: boolean) {
  const session = useRef<LiveVoiceSession | null>(null);
  const refreshConfig = useRef(() => {});
  const endSession = () => session.current?.end();

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void fetch("/api/live/config", { cache: "no-store" }).then(r => {
        if (!r.ok) throw new Error();
        return r.json();
      }).then(config => {
        if (disposed) return;
        const state = useVoiceStore.getState();
        state.setLiveVoiceEnabled(config.enabled === true);
        if (config.providers?.length && !state.liveProviderId) state.setLiveProviderId(config.providers[0].id);
        if (config.voices?.length && !config.voices.includes(state.liveVoice)) state.setLiveVoice(config.voices[0]);
      }).catch(() => {});
    };
    refreshConfig.current = refresh;
    refresh();
    const timer = setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; clearInterval(timer); refreshConfig.current = () => {}; window.removeEventListener("focus", refresh); };
  }, []);

  useEffect(() => {
    if (!enabled) { endSession(); return; }
    const state = useVoiceStore.getState();
    state.setSessionActive(false);
    state.setStatus("idle");
    state.clearExpression();
    state.clearCaptions();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || (event.target as HTMLElement)?.closest?.('[role="dialog"]')) return;
      if (session.current) { event.preventDefault(); endSession(); }
    };
    const onHidden = () => { if (document.hidden) endSession(); };
    const unsubscribe = useVoiceStore.subscribe((next, previous) => {
      if (!next.liveVoiceEnabled || !next.liveMode || next.mode === "chat" || next.liveProviderId !== previous.liveProviderId || next.liveVoice !== previous.liveVoice) endSession();
    });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", endSession);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      unsubscribe();
      endSession();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", endSession);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [enabled]);

  return { endSession, tapMicrophone: () => {
    if (session.current) { endSession(); return; }
    const state = useVoiceStore.getState();
    if (!enabled || !state.liveVoiceEnabled || !state.liveMode || state.mode === "chat") return;
    if (!state.liveProviderId) { state.setAssistantCaption("Choose your OpenAI account in Settings → Speech → Live voice."); return; }
    state.clearCaptions();
    state.clearExpression();
    state.setSessionActive(true);
    levelBus.live = true;
    const current = new LiveVoiceSession({
      status: value => useVoiceStore.getState().setStatus(value),
      caption: (role, text) => {
        const state = useVoiceStore.getState();
        if (role === "user") state.setUserCaption(text); else state.setAssistantCaption(text);
      },
      memory: event => useVoiceStore.getState().showMemory(event),
      search: event => {
        const state = useVoiceStore.getState();
        state.showSearch(event);
        useVoiceStore.setState({ search: useVoiceStore.getState().pendingSearch });
      },
      level: (value, microphone) => { levelBus.value = value; levelBus.microphone = microphone; },
      ended: (reason, turns) => {
        if (session.current !== current) return;
        session.current = null;
        refreshConfig.current();
        levelBus.live = false;
        levelBus.value = 0;
        levelBus.microphone = 0;
        const state = useVoiceStore.getState();
        state.setSessionActive(false);
        state.setStatus("idle");
        state.clearExpression();
        for (const turn of turns) if (turn.text.trim()) state.addTurn(turn.role, turn.text);
        if (reason) state.setAssistantCaption(reason);
      },
    });
    session.current = current;
    void current.start({ providerId: state.liveProviderId, voice: state.liveVoice });
  } };
}
