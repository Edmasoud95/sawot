import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import type { VoiceSource } from "../../lib/voiceSearch";
import { API_BASE } from "../../lib/config";

export const ChatLinkSources = createContext<VoiceSource[]>([]);

function LinkThumbnail({ url }: { url: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  return <div className="chat-link-thumbnail-frame" data-state={status} aria-hidden="true">
    {status !== "failed" && <img className="chat-link-preview-thumbnail"
      src={`${API_BASE}/api/chat/link-thumbnail?url=${encodeURIComponent(url)}`}
      alt="" referrerPolicy="no-referrer"
      onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />}
  </div>;
}

export default function ChatLink({ children, ...props }: ComponentProps<"a">) {
  const sources = useContext(ChatLinkSources);
  const anchor = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const [preview, setPreview] = useState<{ left: number; top: number; above: boolean; title: string; host: string; url: string } | null>(null);
  const close = () => { clearTimeout(timer.current); setPreview(null); };
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", dismiss);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!anchor.current || !props.href) return;
      const url = new URL(props.href, window.location.href);
      if (!["http:", "https:"].includes(url.protocol)) return;
      const source = sources.find(source => source.url.split("#")[0] === url.href.split("#")[0]);
      const rect = anchor.current.getBoundingClientRect();
      const above = window.innerHeight - rect.bottom < 340 && rect.top > window.innerHeight - rect.bottom;
      setPreview({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
        top: above ? rect.top - 8 : rect.bottom + 8,
        above,
        title: source?.title || anchor.current.textContent?.trim() || url.hostname,
        host: url.hostname.replace(/^www\./, ""),
        url: url.href,
      });
    }, 250);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(null), 150); };
  return <>
    <a {...props} ref={anchor} target="_blank" rel="noopener noreferrer"
      aria-describedby={preview ? id : props["aria-describedby"]}
      onMouseEnter={event => { props.onMouseEnter?.(event); show(); }}
      onMouseLeave={event => { props.onMouseLeave?.(event); hide(); }}
      onFocus={event => { props.onFocus?.(event); show(); }}
      onBlur={event => { props.onBlur?.(event); close(); }}
      onClick={event => { props.onClick?.(event); close(); }}
    >{children}</a>
    {preview && createPortal(<div id={id} role="tooltip" className="chat-link-preview"
      style={{ left: preview.left, top: preview.top, transform: preview.above ? "translateY(-100%)" : undefined }}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}>
      <LinkThumbnail key={preview.url} url={preview.url} />
      <span className="chat-link-preview-host">{preview.host}</span>
      <strong>{preview.title}</strong>
      <span className="chat-link-preview-url">{preview.url}</span>
    </div>, document.body)}
  </>;
}
