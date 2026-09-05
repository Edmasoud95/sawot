import { useState } from "react";
import { useChatStore } from "../../chatStore";

function relTime(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ChevronLeft = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const Trash = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const railBtn =
  "icon-button";

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const openConversation = useChatStore((s) => s.openConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const [confirmId, setConfirmId] = useState(null);

  const setOpen = (sidebarOpen) => useChatStore.setState({ sidebarOpen });

  const pick = (id) => {
    openConversation(id);
    // Overlay mode on small screens — dismiss after choosing.
    if (window.matchMedia("(max-width: 639px)").matches) setOpen(false);
  };

  if (!sidebarOpen) {
    return (
      <div className="sidebar-rail">
        <button onClick={() => setOpen(true)} aria-label="Open sidebar" className={railBtn}>
          <ChevronRight />
        </button>
        <button onClick={() => newConversation()} aria-label="New chat" className={railBtn}>
          <Plus />
        </button>
      </div>
    );
  }

  const sorted = [...conversations].sort((a, b) => b.updated - a.updated);

  return (
    <>
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[2px] sm:hidden"
      />
      <aside className="chat-sidebar">
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          <h2 className="eyebrow">
            Conversations
          </h2>
          <button onClick={() => setOpen(false)} aria-label="Collapse sidebar" className={railBtn}>
            <ChevronLeft />
          </button>
        </div>
        <div className="px-4 pb-3">
          <button
            onClick={() => newConversation()}
            className="new-chat-button"
          >
            <Plus /> New conversation
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {sorted.length === 0 && (
            <li className="px-2 pt-2 text-sm leading-relaxed text-zinc-500">
              Your conversations will appear here.
            </li>
          )}
          {sorted.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => pick(c.id)}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-3 pr-9 text-left transition-colors duration-200 ${
                  c.id === activeId
                    ? "bg-white/[0.07] text-zinc-100"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[0.8rem] leading-snug">
                  {c.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {relTime(c.updated)}
                </span>
              </button>
              <button
                onClick={() => {
                  if (confirmId === c.id) {
                    setConfirmId(null);
                    removeConversation(c.id);
                  } else {
                    setConfirmId(c.id);
                  }
                }}
                onBlur={() => setConfirmId((id) => (id === c.id ? null : id))}
                aria-label={confirmId === c.id ? "Confirm delete" : `Delete ${c.title}`}
                className={`absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md transition-all duration-200 ${
                  confirmId === c.id
                    ? "bg-aurora-ember/15 text-aurora-ember opacity-100"
                    : "text-zinc-600 opacity-0 hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100"
                }`}
              >
                {confirmId === c.id ? <Check /> : <Trash />}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
