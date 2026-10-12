import { chatPositions } from "../../lib/chatVisit";
import MemoryActivity from "./MemoryActivity";
import AnalysisActivity, { AnalysisFiles } from "./AnalysisActivity";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMessageReader } from "../../hooks/useMessageReader";
import { useChatStore } from "../../chatStore";
import Message, { MessageBody, ToolChips, CardGrid } from "./Message";
import Welcome from "./Welcome";
import ChatSources from "./ChatSources";

const BOTTOM_TOLERANCE_PX = 24;

export default function MessageList({ sendControl }) {
  const active = useChatStore((s) => s.active);
  const streaming = useChatStore((s) => s.streaming);
  const scrollToLatestRequest = useChatStore(s => s.scrollToLatestRequest);
  const consumedScrollRequest = useRef(scrollToLatestRequest);
  const { reading, reader } = useMessageReader(active?.id, streaming);
  const regenerate = useChatStore(s => s.regenerateMessage);
  const edit = useChatStore(s => s.editMessage);
  const branch = useChatStore(s => s.branchMessage);
  const branchingMessage = useChatStore(s => s.branchingMessage);
  const backgroundResponding = useChatStore(s => s.backgroundResponding);
  const settingsSaving = useChatStore(s => s.settingsSaving || s.reconciling);
  const messageError = useChatStore(s => s.messageError);
  const streamText = useChatStore((s) => s.streamText);
  const streamParts = useChatStore(s => s.streamParts);
  const streamThinking = useChatStore((s) => s.streamThinking);
  const streamMemory = useChatStore(s => s.streamMemory);
  const streamAnalysis = useChatStore(s => s.streamAnalysis);
  const streamTools = useChatStore((s) => s.streamTools);
  const streamSearch = useChatStore((s) => s.streamSearch);
  const streamCards = useChatStore((s) => s.streamCards);

  const scrollRef = useRef(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newReply, setNewReply] = useState(false);
  const previousReply = useRef<any>(null);
  const nearBottomRef = useRef(true);
  const lastScrollTop = useRef(0);
  const touchY = useRef<number | null>(null);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < lastScrollTop.current) nearBottomRef.current = false;
    else if (el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_TOLERANCE_PX) nearBottomRef.current = true;
    lastScrollTop.current = el.scrollTop;
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_TOLERANCE_PX;
    setAwayFromBottom(away);
    if (!away) setNewReply(false);
    if (active?.id) chatPositions.set(active.id, { top: el.scrollTop, following: nearBottomRef.current });
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
    setAwayFromBottom(false);
    setNewReply(false);
  };

  // Keep a position per conversation across mode switches and cold restoration.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !active?.id) return;
    const id = active.id;
    const position = chatPositions.get(id);
    nearBottomRef.current = position?.following ?? true;
    previousReply.current = null;
    setNewReply(false);
    el.scrollTop = nearBottomRef.current ? el.scrollHeight : position.top;
    lastScrollTop.current = el.scrollTop;
    setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_TOLERANCE_PX);
    return () => { chatPositions.set(id, { top: el.scrollTop, following: nearBottomRef.current }); };
  }, [active?.id]);

  // A local send explicitly resumes following. Consume once so reply updates
  // and remounting this conversation cannot pull the reader back down.
  useLayoutEffect(() => {
    if (consumedScrollRequest.current === scrollToLatestRequest) return;
    consumedScrollRequest.current = scrollToLatestRequest;
    if (scrollToLatestRequest?.conversationId !== active?.id) return;
    jumpToLatest();
    if (scrollRef.current) chatPositions.set(active.id, { top: scrollRef.current.scrollTop, following: true });
  }, [scrollToLatestRequest, active?.id]);

  // Follow new content, but only when the user is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    const lastAssistant = active?.messages?.filter(message => message.role === "assistant").slice(-1)[0];
    const reply = { lastAssistant, streamText, streamThinking, streamTools, streamCards, streamSearch, streamAnalysis, streamMemory };
    const changed = previousReply.current && Object.keys(reply).some(key => reply[key] !== previousReply.current[key]);
    previousReply.current = reply;
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      lastScrollTop.current = el.scrollTop;
    } else if (changed && (streaming || lastAssistant)) {
      setNewReply(true);
    }
    if (el) setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_TOLERANCE_PX);
  }, [active?.messages, streamText, streamThinking, streamTools, streamCards, streamSearch, streamAnalysis, streamMemory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !contentRef.current) return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) { el.scrollTop = el.scrollHeight; lastScrollTop.current = el.scrollTop; }
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > BOTTOM_TOLERANCE_PX;
      setAwayFromBottom(away);
      if (!away) setNewReply(false);
    });
    observer.observe(el);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const messages = active?.messages || [];
  // Token updates only change the live bubble; saved message trees stay intact.
  const savedMessages = useMemo(() => messages.map((msg, i) => (
          <Message key={`${active.id}:${i}`} message={msg} conversationId={active.id} sendControl={sendControl}
            reading={reading?.key === `${active.id}:${i}` ? reading : null}
            onRead={text => void reader.toggle(`${active.id}:${i}`, text)}
            onEdit={text => { reader.stop(); void edit(i, text); }}
            onBranch={() => { reader.stop(); void branch(i); }} branching={branchingMessage === i}
            onRegenerate={() => { reader.stop(); void regenerate(i); }} disabled={streaming || backgroundResponding || settingsSaving || branchingMessage !== null} />
        )),
    [messages, active?.id, sendControl, reading, reader, edit, branch, branchingMessage, regenerate, streaming, backgroundResponding, settingsSaving]);

  return (
    <div className="message-list-region">
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onWheel={event => { if (event.deltaY < 0) nearBottomRef.current = false; }}
      onTouchStart={event => { touchY.current = event.touches[0]?.clientY ?? null; }}
      onTouchMove={event => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchY.current !== null && y > touchY.current) nearBottomRef.current = false;
        touchY.current = y ?? null;
      }}
      onKeyDown={event => {
        if ((event.target as HTMLElement).closest("textarea, input, [contenteditable=true]")) return;
        if (["ArrowUp", "PageUp", "Home"].includes(event.key)) nearBottomRef.current = false;
      }}
      className="message-scroll min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
    >
      {messages.length === 0 && !streaming && <Welcome />}
      <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
        {savedMessages}
        {messageError && <p role="alert" className="message-action-error">{messageError}</p>}
        {streaming && (
          <div>
            <ToolChips tools={streamTools.filter(tool => !["web_search", "fetch_page", "find_in_page", "present_results", "download_file", "run_python"].includes(tool.name))} />
            <AnalysisActivity conversationId={active.id} events={streamAnalysis} />
            <MemoryActivity events={streamMemory} />
            <MessageBody message={{ parts: streamParts, content: streamText, thinking: streamThinking }} streaming search={streamSearch} />
            <AnalysisFiles conversationId={active.id} events={streamAnalysis} />
            {!streamThinking && !streamText && streamTools.length === 0 && !streamAnalysis?.length && !streamMemory?.length && (
              <p className="thinking-shimmer font-mono text-[0.65rem] uppercase tracking-[0.25em]">
                Thinking…
              </p>
            )}
            <CardGrid cards={streamCards} sendControl={sendControl} />
            <ChatSources search={streamSearch} />
          </div>
        )}
      </div>
    </div>
    {awayFromBottom && <button type="button" className="jump-to-latest" onClick={jumpToLatest}>
      <span aria-hidden="true">↓</span> {newReply ? "New reply" : "Latest"}
    </button>}
    </div>
  );
}
