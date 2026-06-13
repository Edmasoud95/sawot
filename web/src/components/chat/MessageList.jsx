import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../../chatStore";
import Message, { Markdown, ToolChips, CardGrid } from "./Message";
import ThinkingBlock from "./ThinkingBlock";

const NEAR_BOTTOM_PX = 120;

export default function MessageList({ sendControl }) {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const streamText = useChatStore((s) => s.streamText);
  const streamThinking = useChatStore((s) => s.streamThinking);
  const streamTools = useChatStore((s) => s.streamTools);
  const streamCards = useChatStore((s) => s.streamCards);

  const scrollRef = useRef(null);
  const nearBottomRef = useRef(true);

  // Thinking duration, measured client-side from first thinking delta to
  // first content delta. Reset when a fresh stream begins.
  const thinkStartRef = useRef(null);
  const [thinkSecs, setThinkSecs] = useState(null);
  useEffect(() => {
    if (streaming && !streamThinking && !streamText) {
      thinkStartRef.current = null;
      setThinkSecs(null);
      return;
    }
    if (streamThinking && thinkStartRef.current == null) {
      thinkStartRef.current = performance.now();
    }
    if (streamText && thinkStartRef.current != null) {
      setThinkSecs((prev) =>
        prev ?? Math.max(1, Math.round((performance.now() - thinkStartRef.current) / 1000))
      );
    }
  }, [streaming, streamThinking, streamText]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  // Jump to bottom when switching conversations.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [active?.id]);

  // Follow new content, but only when the user is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages, streamText, streamThinking, streamTools, streamCards]);

  const messages = active?.messages || [];
  const liveThinking = streaming && !streamText;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
        {messages.map((msg, i) => (
          <Message key={i} message={msg} sendControl={sendControl} />
        ))}
        {streaming && (
          <div>
            <ThinkingBlock
              thinking={streamThinking}
              live={liveThinking}
              seconds={thinkSecs}
            />
            <ToolChips tools={streamTools} />
            {streamText && <Markdown>{streamText}</Markdown>}
            {!streamThinking && !streamText && streamTools.length === 0 && (
              <p className="thinking-shimmer font-mono text-[0.65rem] uppercase tracking-[0.25em]">
                Thinking…
              </p>
            )}
            <CardGrid cards={streamCards} sendControl={sendControl} />
          </div>
        )}
      </div>
    </div>
  );
}
