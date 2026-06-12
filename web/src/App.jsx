import Orb from "./components/Orb";
import Captions from "./components/Captions";
import PushToTalk from "./components/PushToTalk";
import HistoryDrawer from "./components/HistoryDrawer";
import { useVoice } from "./hooks/useVoice";

export default function App() {
  const { startTalking, stopTalking } = useVoice();
  return (
    <main className="grain vignette relative grid h-dvh grid-rows-[1fr_auto_auto] place-items-center overflow-hidden pb-[calc(28px+env(safe-area-inset-bottom))]">
      <h1 className="absolute left-6 top-[calc(20px+env(safe-area-inset-top))] select-none font-mono text-[0.65rem] font-light uppercase tracking-[0.32em] text-zinc-600">
        Voice
      </h1>
      <div className="row-start-1 h-[min(72vw,68vh,440px)] w-[min(72vw,68vh,440px)] animate-rise-in">
        <Orb />
      </div>
      <Captions />
      <PushToTalk onStart={startTalking} onStop={stopTalking} />
      <HistoryDrawer />
    </main>
  );
}
