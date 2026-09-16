import { useChatStore } from "../../chatStore";
import MobileHeader from "../MobileHeader";

export default function ChatHeader({ menuRef, mobile }) {
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const active = useChatStore((s) => s.active);
  const title = active?.title ?? "New conversation";

  if (mobile) return <MobileHeader menu={
    <button ref={menuRef} type="button" className="icon-button chat-history-menu"
      aria-label="Open chat history" aria-expanded={sidebarOpen} aria-controls="chat-history"
      onClick={() => useChatStore.setState({ sidebarOpen: true })}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  }><h2 className="sr-only">{title}</h2></MobileHeader>;

  return <header className="chat-header">
    <h2 className="min-w-0 flex-1 truncate font-sans text-base font-medium text-zinc-100">{title}</h2>
  </header>;
}
