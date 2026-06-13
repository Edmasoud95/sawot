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
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/5 py-2.5 pl-4 pr-[124px]">
      <h2 className="min-w-0 flex-1 truncate font-serif text-[1.1rem] text-zinc-100">
        {active.title}
      </h2>
      <label className="flex shrink-0 items-center gap-2">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-zinc-600">
          model
        </span>
        <select
          value={active.model}
          onChange={(e) => renameModel(e.target.value)}
          className="max-w-[180px] truncate rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-mono text-[0.7rem] text-zinc-300 outline-none backdrop-blur transition-colors duration-300 hover:border-white/25 focus:border-aurora-teal/50"
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
