import { useChatStore } from "../../chatStore";
import { useModels } from "./useModels";

export default function ChatHeader() {
  const active = useChatStore((s) => s.active);
  const renameModel = useChatStore((s) => s.renameModel);
  const models = useModels();

  if (!active) return null;

  // Fall back to just the conversation's model until (or if) the list loads.
  const options = models.length
    ? models.includes(active.model)
      ? models
      : [active.model, ...models]
    : [active.model];

  return (
    <header className="chat-header">
      <h2 className="min-w-0 flex-1 truncate font-sans text-base font-medium text-zinc-100">
        {active.title}
      </h2>
      <label className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-zinc-500">
          Model
        </span>
        <select
          value={active.model}
          onChange={(e) => renameModel(e.target.value)}
          className="max-w-[200px] truncate rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[0.78rem] text-zinc-300 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50"
        >
          {options.map((m) => (
            <option key={m} value={m} className="bg-ink-900">
              {m}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
