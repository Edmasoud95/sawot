import { messageParts } from "../../lib/messageParts";
import MemoryActivity from "./MemoryActivity";
import AnalysisActivity, { AnalysisFiles } from "./AnalysisActivity";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { rehypeChatCodeLanguages } from "../../lib/chatCodeLanguages";
import { remarkChatMermaid } from "../../lib/chatMermaid";
import MermaidBlock from "./MermaidBlock";
import ChartWidget from "./ChartWidget";
import { parseChartWidget } from "../../lib/chartWidget";
import EntityCard from "../cards/EntityCard";
import ThinkingBlock from "./ThinkingBlock";
import ToolChip from "./ToolChip";
import MessageActions from "./MessageActions";
import ChatSources from "./ChatSources";
import ChatLink, { ChatLinkSources } from "./ChatLink";
import ArticleCard from "./ArticleCard";
import SelectedResults from "./SelectedResults";
import ProductCards from "./ProductCards";
import { parseProductCards } from "../../lib/productCards";
import { rehypeArticleCards } from "../../lib/articleCards";
import { updateVoiceSearch } from "../../lib/voiceSearch";

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

const SelectedCardsMode = createContext<'legacy' | 'selected' | 'unselected'>('legacy');

function MarkdownCodeBlock(props) {
  const selectedCards = useContext(SelectedCardsMode);
  const sources = useContext(ChatLinkSources);
  const code = props.node?.children?.[0];
  const fallback = <CodeBlock {...props} />;
  const source = code.children?.map(child => child.value ?? "").join("") ?? "";
  if (code?.properties?.className?.includes("language-product_cards_v1")) {
    if (selectedCards !== 'legacy') {
      if (selectedCards === 'selected' || code.properties.dataMermaidPending) return null;
      // An older format may still be generated from conversation history. Keep only
      // its verified links, never model-authored titles, prices or card selection.
      const legacy = parseProductCards(source);
      const urls = new Set(legacy?.items.map(item => item.url));
      const known = sources.filter(item => urls.has(item.url));
      return known.length ? <div>{known.map(item => <p key={item.url}><ChatLink href={item.url}>{item.title}</ChatLink></p>)}</div>
        : <p className="text-sm text-zinc-400">No verified product links were provided.</p>;
    }
    if (code.properties.dataMermaidPending) return <p className="chat-products-pending" role="status">Preparing products…</p>;
    const products = parseProductCards(source);
    return products ? <ProductCards products={products} /> : fallback;
  }
  if (code?.properties?.className?.includes("language-charts_widget_v2")) {
    if (code.properties.dataMermaidPending) return fallback;
    const chart = parseChartWidget(source);
    return chart ? <ChartWidget key={source} chart={chart} /> : <>
      <p className="text-sm text-zinc-400">Could not render chart. Source shown below.</p>{fallback}
    </>;
  }
  if (!code?.properties?.className?.includes("language-mermaid")) return fallback;
  return <MermaidBlock source={source} pending={Boolean(code.properties.dataMermaidPending)}>
    {fallback}
  </MermaidBlock>;
}

function MarkdownLink({ node, 'data-article-card': _articleCard, ...props }) {
  if (node?.properties?.dataArticleCard && props.href) return <ArticleCard href={props.href}>{props.children}</ArticleCard>;
  return <ChatLink {...props} />;
}

const MD_COMPONENTS = { a: MarkdownLink, pre: MarkdownCodeBlock, table: ScrollableTable };

// Saved messages need no Markdown parsing when another response streams.
export const Markdown = memo(function Markdown({ children, streaming = false, search = null }: { children: string; streaming?: boolean; search?: any }) {
  const chart = !streaming && typeof children === "string" ? parseChartWidget(children) : null;
  if (chart) return <div className="chat-md"><ChartWidget key={children} chart={chart} /></div>;
  return (
    <div className="chat-md text-[1rem] font-light leading-relaxed text-zinc-200">
      <SelectedCardsMode.Provider value={search?.presentationVersion !== 1 ? 'legacy' : search.presentations?.length ? 'selected' : 'unselected'}>
      <ChatLinkSources.Provider value={search ? updateVoiceSearch(null, { ...search, phase: "complete" })?.sources ?? [] : []}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkChatMermaid, { streaming }]]}
        rehypePlugins={[[rehypeArticleCards, { streaming, enabled: search?.presentationVersion !== 1 }], rehypeChatCodeLanguages, [rehypeHighlight, { plainText: ["mermaid", "charts_widget_v2", "product_cards_v1"] }]]}
        components={MD_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
      </ChatLinkSources.Provider>
      </SelectedCardsMode.Provider>
    </div>
  );
});

export function MessageBody({ message, streaming = false, search = null }) {
  const parts = messageParts(message);
  if (streaming || message.presentationVersion === 1) search = {tool: 'web_search', phase: 'complete', sources: [], ...search, presentationVersion: 1};
  return <>{parts.map((part, index) => part.type === "thinking"
    ? <ThinkingBlock key={index} thinking={part.text} live={streaming && index === parts.length - 1} />
    : <div key={index} data-message-content><Markdown streaming={streaming && index === parts.length - 1} search={search}>{part.text}</Markdown></div>)}<SelectedResults search={search} /></>;
}

export function ToolChips({ tools }) {
  if (!tools?.length) return null;
  return (
    <div className="mb-3 flex flex-col items-start">
      {tools.map((tool, i) => (
        <ToolChip key={i} tool={tool} />
      ))}
    </div>
  );
}

export function CardGrid({ cards, sendControl }) {
  if (!cards?.length) return null;
  if (cards.length <= 2) return <div className="chat-device-cards">
    {cards.map(card => <EntityCard key={card.entity_id} card={card} sendControl={sendControl}/>)}
  </div>;
  const visible = cards.slice(0, 30);
  return <section className="chat-device-list" aria-label="Home Assistant devices">
    <p className="chat-device-heading">Devices <span>· {visible.length}{cards.length > 30 ? ` of ${cards.length}` : ""}</span></p>
    <div className="chat-device-scroll" tabIndex={0} role="group" aria-label="Scrollable devices">
      {visible.map(card => <EntityCard key={card.entity_id} card={card} sendControl={sendControl} compact/>)}
    </div>
  </section>;
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

function UserMessage({ message, actions, textRef, bubbleRef, editor }) {
  return (
    <div className="flex justify-end">
      <div className="user-message-body max-w-[85%]">
      <div ref={bubbleRef} className="rounded-2xl bg-white/5 px-4 py-2.5">
        {message.attachments?.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-start gap-1.5">
            {message.attachments.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        {editor || <p ref={textRef} className="whitespace-pre-wrap text-[1rem] font-light leading-relaxed text-zinc-100">
          {message.content}
        </p>}
      </div>
      {!editor && <div className="message-footer message-footer-user">{actions}</div>}
      </div>
    </div>
  );
}

// One persisted message. Live streaming messages are composed directly in
// MessageList from the stream buffers using the exported pieces above.
export default function Message({ conversationId, message, sendControl, reading, onRead, onRegenerate, onEdit, onBranch, branching, disabled }) {
  const textRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const closeEditor = () => {
    setEditing(false);
    requestAnimationFrame(() => {
      const body = textRef.current?.closest(".user-message-body");
      const edit = body?.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
      (edit?.getClientRects().length ? edit : body?.querySelector<HTMLButtonElement>('button[aria-label="More message actions"]'))?.focus();
    });
  };
  useEffect(() => { if (disabled) setEditing(false); }, [disabled]);
  const actions = <MessageActions text={message.content ?? ""} textRef={message.role === "user" ? bubbleRef : textRef} getSpokenText={() => {
    const node = textRef.current?.cloneNode(true) as HTMLElement | undefined;
    node?.querySelectorAll("button, style, script, [data-thinking]").forEach(element => element.remove());
    node?.querySelectorAll("p, li, pre, h1, h2, h3, h4, blockquote, tr, br").forEach(block => block.append(document.createTextNode("\n")));
    return node?.textContent?.trim() || message.content || "";
  }} reading={reading} onRead={onRead} onRegenerate={onRegenerate} onBranch={onBranch} branching={branching} disabled={disabled}
    onEdit={message.role === "user" ? () => {
      setEditText(message.content ?? "");
      setEditing(true);
    } : undefined} />;
  if (message.role === "user") return <UserMessage message={message} actions={actions} textRef={textRef} bubbleRef={bubbleRef}
    editor={editing ? <form className="message-editor" onSubmit={event => {
      event.preventDefault();
      if (disabled || (!editText.trim() && !message.attachments?.length)) return;
      setEditing(false);
      onEdit(editText);
    }}>
      <textarea aria-label="Edit message text" autoFocus rows={Math.min(10, Math.max(3, editText.split("\n").length))}
        value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); closeEditor(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <p>Resending replaces the replies and messages after this one.</p>
      <div className="message-editor-buttons">
        <button type="button" onClick={closeEditor}>Cancel</button>
        <button type="submit" disabled={disabled || (!editText.trim() && !message.attachments?.length)}>Save &amp; resend</button>
      </div>
    </form> : null} />;
  return (
    <div>
      <AnalysisActivity conversationId={conversationId} events={message.analysis ?? []} />
      <MemoryActivity events={message.memory ?? []} />
      <div ref={textRef}><MessageBody message={message} search={message.search} /></div>
      <AnalysisFiles conversationId={conversationId} events={message.analysis ?? []} />
      <CardGrid cards={message.cards} sendControl={sendControl} />
      <div className="message-footer">{actions}<ChatSources search={message.search} /></div>
    </div>
  );
}
