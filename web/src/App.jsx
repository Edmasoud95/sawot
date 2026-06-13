import Orb from "./components/Orb";
import Captions from "./components/Captions";
import PushToTalk from "./components/PushToTalk";
import HistoryDrawer from "./components/HistoryDrawer";
import SettingsPanel from "./components/SettingsPanel";
import CardGrid from "./components/cards/CardGrid";
import { useVoice } from "./hooks/useVoice";
import { useVoiceStore } from "./store";

export default function App() {
  const { startTalking, stopTalking, sendControl } = useVoice();
  const mode = useVoiceStore((s) => s.mode);
  const toggleMode = useVoiceStore((s) => s.toggleMode);
  return (
    <main className="grain vignette relative flex h-dvh flex-col items-center overflow-hidden pb-[calc(28px+env(safe-area-inset-bottom))]">
      <h1 className="absolute left-6 top-[calc(20px+env(safe-area-inset-top))] select-none font-mono text-[0.65rem] font-light uppercase tracking-[0.32em] text-zinc-600">
        Voice
      </h1>
      <button
        onClick={toggleMode}
        aria-label={mode === "orb" ? "Switch to control cards" : "Switch to orb"}
        aria-pressed={mode === "cards"}
        className="absolute right-5 top-[calc(64px+env(safe-area-inset-top))] z-30 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-400 backdrop-blur-md transition-colors duration-300 hover:border-white/25 hover:text-zinc-200"
      >
        {mode === "orb" ? (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
          </svg>
        )}
      </button>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
        {mode === "orb" ? (
          <div className="h-[min(64vw,48vh,380px)] w-[min(64vw,48vh,380px)] animate-rise-in">
            <Orb />
          </div>
        ) : (
          <div className="flex w-full flex-1 items-center justify-center overflow-y-auto py-4">
            <CardGrid sendControl={sendControl} />
          </div>
        )}
        <Captions />
      </div>
      <PushToTalk onStart={startTalking} onStop={stopTalking} />
      <HistoryDrawer />
      <SettingsPanel />
    </main>
  );
}
