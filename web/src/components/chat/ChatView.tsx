import { hasPendingNotificationTarget, notificationNavigationVersion, openPendingNotificationTarget } from "../../lib/notificationNavigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useChatStore } from "../../chatStore";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";
import Welcome from "./Welcome";
import CommandResultDrawer from "./CommandResultDrawer";

export default function ChatView({ sendControl, mobile }) {
  const active = useChatStore((s) => s.active);
  const messageError = useChatStore((s) => s.messageError);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const newConversation = useChatStore((s) => s.newConversation);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const creating = useChatStore(s => s.creatingConversation);
  const createError = useChatStore(s => s.createError);
  const historyError = useChatStore(s => s.historyError);
  const historyLoading = useChatStore(s => s.historyLoading);
  const restoreVisit = useChatStore(s => s.restoreVisit);
  const visitLoading = useChatStore(s => s.visitLoading);
  const visitError = useChatStore(s => s.visitError);
  const previous = useChatStore(s => s.previousConversation);
  const [continuing, setContinuing] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSidebar = useCallback(() => useChatStore.setState({ sidebarOpen: false }), []);
  useDialogFocus(mobile && sidebarOpen, panel, trigger, closeSidebar);

  useEffect(() => {
    if (mobile) closeSidebar();
  }, [mobile, closeSidebar]);

  useEffect(() => {
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      if (hasPendingNotificationTarget()) { void openPendingNotificationTarget(); return; }
      void useChatStore.getState().refreshPrivacy();
      void useChatStore.getState().resumeConversation();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    resume();
    return () => {
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);

  useEffect(() => {
    const version = notificationNavigationVersion();
    void loadConversations();
    if (hasPendingNotificationTarget()) { void openPendingNotificationTarget(); return; }
    // Decide immediately so later user navigation always supersedes startup.
    void restoreVisit(() => notificationNavigationVersion() === version && !hasPendingNotificationTarget());
  }, [loadConversations, restoreVisit]);

  useEffect(() => {
    let lastSaved = 0;
    const save = () => {
      useChatStore.getState().rememberVisit();
      void useChatStore.getState().flushDraft(true).catch(() => {});
      lastSaved = Date.now();
    };
    const activity = () => { if (Date.now() - lastSaved > 10000) save(); };
    const visibility = () => { if (document.visibilityState === "hidden") save(); };
    // Save on selection/exit, not on token updates. No continuous storage writes.
    useChatStore.getState().rememberVisit();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [active?.id]);

  return (
    <div className="chat-workspace">
      <Sidebar panelRef={panel} mobile={mobile} />
      <div className="chat-main" inert={mobile && sidebarOpen}>
        <ChatHeader menuRef={trigger} mobile={mobile} />
        {!sidebarOpen && (createError || historyError) && <div className="chat-notice" role="alert">
          <span>{createError || historyError}</span>
          <button type="button" disabled={creating || historyLoading} onClick={() => createError ? void newConversation() : void loadConversations()}>Retry</button>
        </div>}
        {active ? (
          <>
            {active.privateMemoryUsed && <div className="chat-notice" role="status">
              <span>Private chat · Only providers with private memory access can continue this conversation.</span>
              <button type="button" disabled={creating} onClick={() => void newConversation()}>New chat</button>
            </div>}
            <MessageList sendControl={sendControl} />
            {previous && !active.messages.length && !active.draftText?.trim() && <button
              className="mx-auto mb-3 flex max-w-[calc(100%_-_2rem)] items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              disabled={continuing || creating} onClick={async () => {
                setContinuing(true);
                try { await useChatStore.getState().openConversation(previous.id); }
                finally { setContinuing(false); }
              }}>
              <span className="shrink-0">{continuing ? "Opening…" : previous.hasDraft ? "Resume draft" : "Continue previous chat"}</span>
              <span className="truncate">— {previous.title}</span>
            </button>}
            <Composer />
          </>
        ) : (
          <>
            {messageError && <p role="alert" className="px-4 pt-4 text-sm text-red-400">{messageError}</p>}
            {visitLoading ? <p role="status" className="m-auto text-sm text-zinc-500">Opening your chat…</p> : <>
              {visitError && <div className="chat-notice" role="alert"><span>{visitError}</span>
                <button onClick={() => void restoreVisit()}>Retry</button></div>}
              <Welcome onStart={() => newConversation()} pending={creating} />
            </>}
          </>
        )}
      </div>
      <CommandResultDrawer />
    </div>
  );
}
