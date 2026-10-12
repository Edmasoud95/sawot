import MotionButton from "../MotionButton";
import { useEffect, useState, useRef } from "react";
import { useSurfaceMotion } from "../../hooks/useSurfaceMotion";
import { useChatStore } from "../../chatStore";
import { listConversations } from "../../lib/chatApi";

function relTime(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function dateGroup(ts: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (ts * 1000 >= today.getTime()) return "Today";
  if (ts * 1000 >= yesterday.getTime()) return "Yesterday";
  return "Earlier";
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
const railBtn =
  "icon-button";

export default function Sidebar({ panelRef, mobile }) {
  const scrim = useRef<HTMLDivElement>(null);
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const openConversation = useChatStore((s) => s.openConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);
  const historyLoading = useChatStore(s => s.historyLoading);
  const historyError = useChatStore(s => s.historyError);
  const loadConversations = useChatStore(s => s.loadConversations);
  const creating = useChatStore(s => s.creatingConversation);
  const createError = useChatStore(s => s.createError);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ query: string; results: any[]; error: string } | null>(null);
  const [retrySearch, setRetrySearch] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<{ id: string; message: string } | null>(null);
  const trimmed = query.trim();
  const searchLoading = Boolean(trimmed && search?.query !== trimmed);
  useEffect(() => {
    if (!trimmed || !sidebarOpen) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void listConversations(trimmed, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
        .then(results => { if (!controller.signal.aborted) setSearch({ query: trimmed, results, error: "" }); })
        .catch(() => { if (!controller.signal.aborted) setSearch({ query: trimmed, results: [], error: "Couldn’t search conversations." }); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed, sidebarOpen, retrySearch, conversations]);
  const [confirmId, setConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const confirmDelete = async (id) => {
    setDeleting(true);
    setDeleteError("");
    try { await removeConversation(id); setConfirmId(null); setSearch(null); }
    catch (error) { setDeleteError(error instanceof Error ? error.message : "Could not delete conversation. Please try again."); }
    finally { setDeleting(false); }
  };

  useSurfaceMotion({ panel: panelRef, scrim, open: sidebarOpen, placement: "left", enabled: mobile });

  const setOpen = (sidebarOpen) => useChatStore.setState({ sidebarOpen });
  const startNew = async () => {
    if (openingId) return;
    setOpenError(null);
    if (await newConversation() && mobile) setOpen(false);
  };

  const pick = async (id) => {
    if (openingId || creating) return;
    setOpeningId(id);
    setOpenError(null);
    try {
      if (await openConversation(id)) { if (mobile) setOpen(false); }
      else setOpenError({ id, message: "Couldn’t open this conversation. Check your connection and retry." });
    } finally { setOpeningId(null); }
  };

  const sorted = [...(trimmed ? search?.query === trimmed ? search.results : [] : conversations)].sort((a, b) => b.updated - a.updated);
  const groups = ["Today", "Yesterday", "Earlier"].map(label => ({ label, items: sorted.filter(c => dateGroup(c.updated) === label) })).filter(group => group.items.length);

  return (
    <>
      {!sidebarOpen && !mobile && (      <div className="sidebar-rail">
        <MotionButton onClick={() => setOpen(true)} aria-label="Open sidebar" className={railBtn}>
          <ChevronRight />
        </MotionButton>
        <MotionButton onClick={() => void startNew()} disabled={creating} aria-label={creating ? "Creating conversation" : "New chat"} className={railBtn}>
          <Plus />
        </MotionButton>
      </div>)}
      <div
        ref={scrim}
        style={{ pointerEvents: mobile && sidebarOpen ? "auto" : "none" }}
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[2px] sm:hidden"
      />
      <aside style={!mobile && !sidebarOpen ? { display: "none" } : undefined} id="chat-history" ref={panelRef} role={mobile ? "dialog" : undefined}
        inert={mobile && !sidebarOpen} aria-modal={mobile && sidebarOpen ? true : undefined} aria-label="Chat history" className="chat-sidebar">
        <div className="flex items-center justify-between px-4 pb-3 pt-1">
          {mobile ? <h1 className="brand" aria-label="SAWOT">sawot<span aria-hidden="true">•</span></h1> : <h2 className="eyebrow">
            Conversations
          </h2>}
          <MotionButton onClick={() => setOpen(false)} aria-label="Collapse sidebar" className={railBtn}>
            <ChevronLeft />
          </MotionButton>
        </div>
        <div className="px-4 pb-3">
          <MotionButton
            onClick={() => void startNew()}
            disabled={creating || Boolean(openingId)}
            className="new-chat-button"
          >
            <Plus /> {creating ? "Creating…" : "New conversation"}
          </MotionButton>
        </div>
        <div className="history-search">
          <input type="search" aria-label="Search conversations" placeholder="Search conversations" maxLength={200}
            value={query} onChange={event => { setQuery(event.target.value); setSearch(null); }} />
        </div>
        {(openError || createError || (!trimmed && historyError) || search?.query === trimmed && search.error) && <div className="history-feedback" role="alert">
          <p>{openError?.message || createError || (trimmed ? search?.error : historyError)}</p>
          <button type="button" disabled={creating || historyLoading || Boolean(openingId)} onClick={() => {
            if (openError) void pick(openError.id);
            else if (createError) void startNew();
            else if (trimmed) { setSearch(null); setRetrySearch(value => value + 1); }
            else void loadConversations();
          }}>Retry</button>
        </div>}
        {openingId && <p className="history-feedback" role="status">Opening conversation…</p>}
        {((!trimmed && historyLoading) || searchLoading) && <p className="history-feedback" role="status">{trimmed ? "Searching…" : "Loading conversations…"}</p>}
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversations">
          {sorted.length === 0 && !searchLoading && !historyLoading && !historyError && !search?.error && (
            <li className="px-2 pt-2 text-sm leading-relaxed text-zinc-500">
              {trimmed ? "No matching conversations." : "Your conversations will appear here."}
            </li>
          )}
          {groups.map(group => <li key={group.label}>
            <h3 className="history-date-label">{group.label}</h3>
            <ul>
          {group.items.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => void pick(c.id)}
                disabled={creating || Boolean(openingId)}
                aria-current={c.id === activeId ? "page" : undefined}
                className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-3 pr-12 text-left transition-colors duration-200 ${
                  c.id === activeId
                    ? "bg-white/[0.07] text-zinc-100"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base leading-snug" title={c.title}>{c.title}</span>
                  {trimmed && c.excerpt && <span className="history-excerpt">{c.excerpt}</span>}
                </span>
                <span className="shrink-0 text-sm text-zinc-500">
                  {relTime(c.updated)}
                </span>
              </button>
              <button
                onClick={() => { setConfirmId(c.id); setDeleteError(""); }}
                disabled={deleting}
                aria-label={`Delete ${c.title}`}
                className="absolute right-1.5 top-0 grid h-11 w-11 place-items-center rounded-md text-zinc-500 hover:text-zinc-200 focus-visible:text-zinc-200"
              >
                <Trash />
              </button>
              {confirmId === c.id && <div className="px-2.5 pb-3 text-sm text-zinc-400"
                onKeyDown={event => { if (event.key === "Escape" && !deleting) { event.stopPropagation(); setConfirmId(null); } }}>
                <p>Delete this conversation and its files? This cannot be undone.</p>
                {deleteError && <p role="alert" className="mt-2 text-aurora-ember">{deleteError}</p>}
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={deleting} onClick={() => setConfirmId(null)} className="min-h-11 rounded-lg px-3 hover:bg-white/[0.06]">Cancel</button>
                  <button type="button" disabled={deleting} onClick={() => void confirmDelete(c.id)} className="min-h-11 rounded-lg bg-aurora-ember/15 px-3 text-aurora-ember">
                    {deleting ? "Deleting…" : "Delete conversation"}
                  </button>
                </div>
              </div>}

            </li>
          ))}
            </ul>
          </li>)}
        </ul>
      </aside>
    </>
  );
}
