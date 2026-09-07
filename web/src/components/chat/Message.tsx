import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import EntityCard from "../cards/EntityCard";
import ThinkingBlock from "./ThinkingBlock";
import ToolChip from "./ToolChip";

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

// Fenced code block: ink-900 surface, language micro-label, copy-on-hover.
function CodeBlock({ children, ...props }) {
  const preRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const lang =
    /language-([\w-]+)/.exec(children?.props?.className || "")?.[1] || "";

  const copy = () => {
    const text = preRef.current?.innerText || "";
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="code-block group relative my-3 overflow-hidden rounded-xl border border-white/10 bg-ink-900">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-1.5">
        <span className="font-mono text-[0.58rem] uppercase tracking-[0.25em] text-zinc-600">
          {lang || "code"}
        </span>
        <button
          onClick={copy}
          aria-label="Copy code"
          className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[0.58rem] uppercase tracking-[0.15em] transition-all duration-300 hover:bg-white/[0.06] ${
            copied
              ? "text-aurora-teal opacity-100"
              : "text-zinc-500 opacity-0 hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100"
          }`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
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

const MD_COMPONENTS = { pre: CodeBlock };

export function Markdown({ children }) {
  return (
    <div className="chat-md text-[0.92rem] font-light leading-relaxed text-zinc-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
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

function UserMessage({ message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl bg-white/5 px-4 py-2.5">
        {message.attachments?.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-start gap-1.5">
            {message.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-[0.92rem] font-light leading-relaxed text-zinc-100">
          {message.content}
        </p>
      </div>
    </div>
  );
}

// One persisted message. Live streaming messages are composed directly in
// MessageList from the stream buffers using the exported pieces above.
export default function Message({ message, sendControl }) {
  if (message.role === "user") return <UserMessage message={message} />;
  return (
    <div>
      <ThinkingBlock thinking={message.thinking} />
      <Markdown>{message.content}</Markdown>
      <CardGrid cards={message.cards} sendControl={sendControl} />
    </div>
  );
}
