import { useEffect, useState } from "react";
import Orb from "./components/Orb";
import Captions from "./components/Captions";
import VoiceSources from "./components/VoiceSources";
import PushToTalk from "./components/PushToTalk";
import HistoryDrawer from "./components/HistoryDrawer";
import SettingsPanel from "./components/SettingsPanel";
import CardGrid from "./components/cards/CardGrid";
import DebugBar from "./components/DebugBar";
import ModeSwitch from "./components/ModeSwitch";
import MobileHeader from "./components/MobileHeader";
import ChatView from "./components/chat/ChatView";
import { useVoice } from "./hooks/useVoice";
import { useModeSwipe } from "./hooks/useModeSwipe";
import { useVoiceStore } from "./store";

export default function App() {
  const { startTalking, stopTalking, sendControl } = useVoice();
  const mode = useVoiceStore((s) => s.mode);
  const debugEnabled = useVoiceStore((s) => s.debugEnabled);
  const hasCaptions = useVoiceStore((s) => !!(s.userCaption || s.assistantCaption));
  const hasSearch = useVoiceStore((s) => !!s.search);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const setMode = useVoiceStore((s) => s.setMode);
  const swipe = useModeSwipe(mobile, mode, setMode);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const onChange = () => setMobile(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return (
    <main className="app-shell" data-mode={mode} data-debug={debugEnabled} {...swipe}>
      {mobile && mode !== "chat" && <MobileHeader menu={<HistoryDrawer mobileMenu />} />}
      {!mobile && <header className="app-header">
        <h1 className="brand" aria-label="SAWOT">sawot<span aria-hidden="true">•</span></h1>
        <div className="header-actions">
          <ModeSwitch />
          <span className="header-divider" aria-hidden="true" />
          <HistoryDrawer />
          <SettingsPanel />
        </div>
      </header>}
      {mode === "chat" ? (
        <ChatView sendControl={sendControl} mobile={mobile} />
      ) : (
        <div className="voice-workspace">
          <div className="voice-content" data-search={hasSearch}>
            {mode === "orb" ? (
              <div className="orb-stage" aria-hidden="true"><Orb /></div>
            ) : (
              <section className="controls-workspace" aria-label="Device controls">
                <CardGrid sendControl={sendControl} />
              </section>
            )}
            <VoiceSources />
            <div className="caption-space" data-visible={hasCaptions}>
              {hasCaptions && <Captions />}
            </div>
          </div>
          <PushToTalk onStart={startTalking} onStop={stopTalking} />
        </div>
      )}
      <DebugBar />
    </main>
  );
}
