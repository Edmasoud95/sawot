import Orb from "./components/Orb";
import Captions from "./components/Captions";
import PushToTalk from "./components/PushToTalk";
import HistoryDrawer from "./components/HistoryDrawer";
import SettingsPanel from "./components/SettingsPanel";
import CardGrid from "./components/cards/CardGrid";
import ModeSwitch from "./components/ModeSwitch";
import ChatView from "./components/chat/ChatView";
import { useVoice } from "./hooks/useVoice";
import { useVoiceStore } from "./store";

export default function App() {
  const { startTalking, stopTalking, sendControl } = useVoice();
  const mode = useVoiceStore((s) => s.mode);
  const hasCaptions = useVoiceStore((s) => !!(s.userCaption || s.assistantCaption));
  return (
    <main className="app-shell" data-mode={mode}>
      <header className="app-header">
        <h1 className="brand" aria-label="SAWOT">sawot<span aria-hidden="true">•</span></h1>
        <div className="header-actions">
          <ModeSwitch />
          <span className="header-divider" aria-hidden="true" />
          <HistoryDrawer />
          <SettingsPanel />
        </div>
      </header>
      {mode === "chat" ? (
        <ChatView sendControl={sendControl} />
      ) : (
        <div className="voice-workspace">
          <div className="voice-content">
            {mode === "orb" ? (
              <div className="orb-stage" aria-hidden="true"><Orb /></div>
            ) : (
              <section className="controls-workspace" aria-label="Device controls">
                <CardGrid sendControl={sendControl} />
              </section>
            )}
            <div className="caption-space" data-visible={hasCaptions}>
              {hasCaptions && <Captions />}
            </div>
          </div>
          <PushToTalk onStart={startTalking} onStop={stopTalking} />
        </div>
      )}
    </main>
  );
}
