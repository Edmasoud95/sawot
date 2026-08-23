import { useEffect } from "react";
import { useChatStore } from "../../chatStore";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";

export default function ChatView({ sendControl }) {
  const active = useChatStore((s) => s.active);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const newConversation = useChatStore((s) => s.newConversation);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <div className="flex min-h-0 w-full flex-1 pt-3">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <ChatHeader />
            <MessageList sendControl={sendControl} />
            <Composer />
          </>
        ) : (
          <div className="flex flex-1 animate-rise-in flex-col items-center justify-center gap-6 px-6">
            <p className="text-center font-serif text-2xl italic text-zinc-500">
              Start a new conversation
            </p>
            <button
              onClick={() => newConversation()}
              className="rounded-full border border-aurora-teal/40 bg-aurora-teal/10 px-5 py-2.5 font-mono text-[0.68rem] uppercase tracking-[0.25em] text-aurora-teal transition-colors duration-300 hover:border-aurora-teal/70 hover:bg-aurora-teal/20"
            >
              new chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
