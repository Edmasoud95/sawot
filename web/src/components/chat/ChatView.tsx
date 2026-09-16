import { useCallback, useEffect, useRef } from "react";
import { useDialogFocus } from "../../hooks/useDialogFocus";
import { useChatStore } from "../../chatStore";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";
import Welcome from "./Welcome";

export default function ChatView({ sendControl, mobile }) {
  const active = useChatStore((s) => s.active);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const newConversation = useChatStore((s) => s.newConversation);
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSidebar = useCallback(() => useChatStore.setState({ sidebarOpen: false }), []);
  useDialogFocus(mobile && sidebarOpen, panel, trigger, closeSidebar);

  useEffect(() => {
    if (mobile) closeSidebar();
  }, [mobile, closeSidebar]);

  useEffect(() => {
    let cancelled = false;
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (isMobile) closeSidebar();
    void loadConversations().then(() => {
      if (!cancelled && isMobile) {
        useChatStore.getState().stopStream();
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
        {active ? (
          <>
            <MessageList sendControl={sendControl} />
            <Composer />
          </>
        ) : (
          <Welcome onStart={() => newConversation()} />
        )}
      </div>
    </div>
  );
}
