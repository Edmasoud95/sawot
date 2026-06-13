import Orb from "./components/Orb";
import Captions from "./components/Captions";
import PushToTalk from "./components/PushToTalk";
import HistoryDrawer from "./components/HistoryDrawer";
import SettingsPanel from "./components/SettingsPanel";
import { useVoice } from "./hooks/useVoice";

export default function App() {
  const { startTalking, stopTalking } = useVoice();
  return (
    <main className="grain vignette relative flex h-dvh flex-col items-center overflow-hidden pb-[calc(28px+env(safe-area-inset-bottom))]">
      <h1 className="absolute left-6 top-[calc(20px+env(safe-area-inset-top))] select-none font-mono text-[0.65rem] font-light uppercase tracking-[0.32em] text-zinc-600">
        Voice
      </h1>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="h-[min(64vw,48vh,380px)] w-[min(64vw,48vh,380px)] animate-rise-in">
          <Orb />
        </div>
        <Captions />
      </div>
      <PushToTalk onStart={startTalking} onStop={stopTalking} />
      <HistoryDrawer />
      <SettingsPanel />
    </main>
  );
}
