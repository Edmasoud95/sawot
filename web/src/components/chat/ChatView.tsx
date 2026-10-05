import { hasPendingNotificationTarget, notificationNavigationVersion, openPendingNotificationTarget } from "../../lib/notificationNavigation";
import { useCallback, useEffect, useRef } from "react";
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
    let cancelled = false;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (isMobile) closeSidebar();
    void loadConversations().then(() => {
      if (cancelled) return;
      if (hasPendingNotificationTarget()) { void openPendingNotificationTarget(); return; }
      if (isMobile && notificationNavigationVersion() === 0) {
        void newConversation();
      }
    });
    return () => { cancelled = true; };
  }, [loadConversations, newConversation, closeSidebar]);

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
            <MessageList sendControl={sendControl} />
            <Composer />
          </>
        ) : (
          <>
            {messageError && <p role="alert" className="px-4 pt-4 text-sm text-red-400">{messageError}</p>}
            <Welcome onStart={() => newConversation()} pending={creating} />
          </>
        )}
      </div>
      <CommandResultDrawer />
    </div>
  );
}
