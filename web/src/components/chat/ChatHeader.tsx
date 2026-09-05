import { useChatStore } from "../../chatStore";
import { splitModelId, useProviders } from "./useModels";

export default function ChatHeader() {
  const active = useChatStore((s) => s.active);
  const renameModel = useChatStore((s) => s.renameModel);
  const providers = useProviders();

  if (!active) return null;

  const groups = providers.filter((p) => p.models.length);
  const known = groups.some((p) =>
    p.models.some((m) => `${p.id}::${m}` === active.model),
  );

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
          {/* Conversation's model until the list loads, or if it's gone. */}
          {!known && (
            <option value={active.model} className="bg-ink-900">
              {splitModelId(active.model).model}
            </option>
          )}
          {groups.map((p) => (
            <optgroup key={p.id} label={p.name} className="bg-ink-900">
              {p.models.map((m) => (
                <option key={m} value={`${p.id}::${m}`} className="bg-ink-900">
                  {m}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </header>
  );
}
