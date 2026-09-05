import { useEffect } from "react";
import { useChatStore } from "../../chatStore";
import Sidebar from "./Sidebar";
import ChatHeader from "./ChatHeader";
import MessageList from "./MessageList";
import Composer from "./Composer";
import Welcome from "./Welcome";

export default function ChatView({ sendControl }) {
  const active = useChatStore((s) => s.active);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const newConversation = useChatStore((s) => s.newConversation);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <div className="chat-workspace">
      <Sidebar />
      <div className="chat-main">
        {active ? (
          <>
            <ChatHeader />
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
