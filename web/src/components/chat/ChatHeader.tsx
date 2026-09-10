import { useChatStore } from "../../chatStore";
import ModelPicker from "../ModelPicker";
import { useProviders } from "./useModels";

export default function ChatHeader() {
  const active = useChatStore((s) => s.active);
  const renameModel = useChatStore((s) => s.renameModel);
  const providers = useProviders();

  if (!active) return null;

  return (
    <header className="chat-header">
      <h2 className="min-w-0 flex-1 truncate font-sans text-base font-medium text-zinc-100">
        {active.title}
      </h2>
      <div className="flex w-[min(280px,45vw)] shrink-0 items-center gap-2">
        <span className="text-xs text-zinc-500">Model</span>
        <ModelPicker compact value={active.model} providers={providers} onChange={renameModel} />
      </div>
    </header>
  );
}
