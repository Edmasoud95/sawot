import { useChatStore } from "../../chatStore";
import ModelPicker from "../ModelPicker";
import { useProviders } from "./useModels";

const House = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-6h4v6" />
  </svg>
);

export default function ChatHeader() {
  const active = useChatStore((s) => s.active);
  const renameModel = useChatStore((s) => s.renameModel);
  const setHomeAssistant = useChatStore((s) => s.setHomeAssistant);
  const providers = useProviders();

  if (!active) return null;
  const ha = Boolean(active.homeAssistant);

  return (
    <header className="chat-header">
      <h2 className="min-w-0 flex-1 truncate font-sans text-base font-medium text-zinc-100">
        {active.title}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setHomeAssistant(!ha)}
          aria-pressed={ha}
          aria-label={ha ? "Home Assistant on" : "Home Assistant off"}
          title={ha ? "Home Assistant tools are on for this chat" : "Turn on Home Assistant tools for this chat"}
          className={`grid h-8 w-8 place-items-center rounded-full border transition-colors duration-200 ${
            ha
              ? "border-white/15 bg-white/[0.08] text-zinc-100"
              : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"
          }`}
        >
          <House />
        </button>
        <div className="flex w-[min(280px,45vw)] items-center gap-2">
          <span className="text-xs text-zinc-500">Model</span>
          <ModelPicker compact value={active.model} providers={providers} onChange={renameModel} />
        </div>
      </div>
    </header>
  );
}
