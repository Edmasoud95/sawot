import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { rehypeChatCodeLanguages } from "../../lib/chatCodeLanguages";
import EntityCard from "../cards/EntityCard";
import ThinkingBlock from "./ThinkingBlock";
import ToolChip from "./ToolChip";
import MessageActions from "./MessageActions";
import ChatSources from "./ChatSources";

const ImageIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// Fenced code block with a persistent, touch-accessible copy control.
function CodeBlock({ children, node: _node, ...props }) {
  const preRef = useRef<HTMLPreElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const [copied, setCopied] = useState(false);
  const lang =
    /language-([^\s]+)/.exec(children?.props?.className || "")?.[1] || "";

  const copy = async () => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(preRef.current?.textContent || "");
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <div className="code-block group relative my-3 overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-1.5">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-zinc-400">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Code copied" : "Copy code"}
          className={`flex min-h-8 items-center gap-1.5 rounded-full px-2.5 font-mono text-[0.65rem] transition-colors duration-150 hover:bg-white/[0.06] active:bg-white/[0.06] ${
            copied ? "text-aurora-teal" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      {copyError && <p role="alert" className="px-3.5 py-2 text-xs text-red-300">Could not copy. Select the code to copy it.</p>}
      <pre
        ref={preRef}
        {...props}
        className="overflow-x-auto bg-transparent px-3.5 py-3 font-mono text-[0.78rem] font-light leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

function ScrollableTable({ children, node: _node, ...props }) {
  return (
    <div className="chat-table-scroll" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>
  );
}

const MD_COMPONENTS = { pre: CodeBlock, table: ScrollableTable };

export function Markdown({ children }) {
  return (
    <div className="chat-md text-[1rem] font-light leading-relaxed text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeChatCodeLanguages, rehypeHighlight]}
        components={MD_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function ToolChips({ tools }) {
  if (!tools?.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {tools.map((tool, i) => (
        <ToolChip key={i} tool={tool} />
      ))}
    </div>
  );
}

export function CardGrid({ cards, sendControl }) {
  if (!cards?.length) return null;
  return (
    <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <EntityCard key={card.entity_id} card={card} sendControl={sendControl} />
      ))}
    </div>
  );
}

const uploadUrl = (a) => `/api/chat/uploads/${a.id}`;

function Attachment({ a }) {
  if (a.kind === "image") {
    return (
      <a
        href={uploadUrl(a)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${a.name} full size`}
        className="block overflow-hidden rounded-xl border border-white/10 transition-opacity hover:opacity-90"
      >
        <img
          src={uploadUrl(a)}
          alt={a.name}
          loading="lazy"
          className="max-h-48 max-w-full object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={uploadUrl(a)}
      target="_blank"
      rel="noreferrer"
      className="flex max-w-[200px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-[0.62rem] text-zinc-300 transition-colors hover:border-white/25 hover:text-zinc-100"
    >
      <span className="text-zinc-500">
        <FileIcon />
      </span>
      <span className="truncate">{a.name}</span>
    </a>
  );
}

function UserMessage({ message, actions, textRef }) {
  return (
    <div className="flex justify-end">
      <div className="user-message-body max-w-[85%]">
      <div className="rounded-2xl bg-white/5 px-4 py-2.5">
        {message.attachments?.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-start gap-1.5">
            {message.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        <p ref={textRef} className="whitespace-pre-wrap text-[1rem] font-light leading-relaxed text-zinc-100">
          {message.content}
        </p>
      </div>
      <div className="message-footer message-footer-user">{actions}</div>
      </div>
    </div>
  );
}

// One persisted message. Live streaming messages are composed directly in
// MessageList from the stream buffers using the exported pieces above.
export default function Message({ message, sendControl, reading, onRead, onRegenerate, disabled }) {
  const textRef = useRef<HTMLDivElement>(null);
  const actions = <MessageActions text={message.content ?? ""} getSpokenText={() => {
    const node = textRef.current?.cloneNode(true) as HTMLElement | undefined;
    node?.querySelectorAll("button, style, script").forEach(element => element.remove());
    node?.querySelectorAll("p, li, pre, h1, h2, h3, h4, blockquote, tr, br").forEach(block => block.append(document.createTextNode("\n")));
    return node?.textContent?.trim() || message.content || "";
  }} reading={reading} onRead={onRead} onRegenerate={onRegenerate} disabled={disabled} />;
  if (message.role === "user") return <UserMessage message={message} actions={actions} textRef={textRef} />;
  return (
    <div>
      <ThinkingBlock thinking={message.thinking} />
      <div ref={textRef}><Markdown>{message.content}</Markdown></div>
      <CardGrid cards={message.cards} sendControl={sendControl} />
      <div className="message-footer">{actions}<ChatSources search={message.search} /></div>
    </div>
  );
}
