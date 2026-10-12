import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import type { VoiceSource } from "../../lib/voiceSearch";
import { linkThumbnailUrl } from '../../lib/linkThumbnail';
import { shouldPreviewLink } from '../../lib/linkPreview';

export const ChatLinkSources = createContext<VoiceSource[]>([]);
export const ProductSearchLinks = createContext(false);

function LinkThumbnail({ url }: { url: string }) {
  const sources = useContext(ChatLinkSources);
  const source = sources.find(source => source.url.split('#')[0] === url.split('#')[0]);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  return <div className="chat-link-thumbnail-frame" data-state={status} aria-hidden="true">
    {status !== "failed" && <img className="chat-link-preview-thumbnail"
      src={linkThumbnailUrl(url, source)}
      alt="" referrerPolicy="no-referrer"
      onLoad={() => setStatus("loaded")} onError={() => setStatus("failed")} />}
  </div>;
}

export default function ChatLink({ children, ...props }: ComponentProps<"a">) {
  const sources = useContext(ChatLinkSources);
  const products = useContext(ProductSearchLinks);
  const anchor = useRef<HTMLAnchorElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const openLink = useRef<HTMLAnchorElement>(null);
  const pointerType = useRef('');
  const pinned = useRef(false);
  const skipFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const [preview, setPreview] = useState<{ left: number; top: number; above: boolean; title: string; host: string; url: string; touch: boolean; imageAllowed: boolean } | null>(null);
  const close = useCallback((restoreFocus = false) => {
    clearTimeout(timer.current);
    pinned.current = false;
    setPreview(null);
    if (restoreFocus && anchor.current) {
      skipFocus.current = true;
      anchor.current.focus({preventScroll:true});
      skipFocus.current = false;
    }
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") close(!!panel.current?.contains(document.activeElement)); };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close(); };
    const resize = () => close();
    window.addEventListener("keydown", dismiss);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [close]);
  useEffect(() => {
    if (!preview?.touch) return;
    const frame = requestAnimationFrame(() => openLink.current?.focus({preventScroll:true}));
    return () => cancelAnimationFrame(frame);
  }, [preview?.touch, preview?.url]);
  const show = (touch = false) => {
    clearTimeout(timer.current);
    let url: URL;
    try { url = new URL(props.href || '', window.location.href); } catch { return false; }
    if (!props.href || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    const reveal = () => {
      if (!anchor.current) return;
      const source = sources.find(source => source.url.split("#")[0] === url.href.split("#")[0]);
      const rect = anchor.current.getBoundingClientRect();
      const above = window.innerHeight - rect.bottom < 400 && rect.top > window.innerHeight - rect.bottom;
      pinned.current = touch;
      setPreview({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)),
        top: above ? rect.top - 8 : rect.bottom + 8,
        above,
        title: source?.title || anchor.current.textContent?.trim() || url.hostname,
        host: url.hostname.replace(/^www\./, ""),
        url: url.href,
        touch,
        imageAllowed: !source?.blocked || !!source.thumbnail,
      });
    };
    if (touch) reveal(); else timer.current = setTimeout(reveal, 250);
    return true;
  };
  const hide = () => { if (pinned.current) return; clearTimeout(timer.current); timer.current = setTimeout(() => close(), 150); };
  if (products && !sources.some(source => source.url.split('#')[0] === props.href?.split('#')[0] && source.pageKind === 'product')) return <span>{children}</span>;
  return <>
    <a {...props} ref={anchor} target="_blank" rel="noopener noreferrer"
      aria-haspopup="dialog" aria-expanded={!!preview} aria-controls={preview ? id : undefined}
      onPointerEnter={event => { pointerType.current = event.pointerType; props.onPointerEnter?.(event); }}
      onPointerDown={event => { pointerType.current = event.pointerType; props.onPointerDown?.(event); }}
      onKeyDown={event => { pointerType.current = ''; props.onKeyDown?.(event); }}
      onMouseEnter={event => { props.onMouseEnter?.(event); if (!pinned.current && pointerType.current !== 'touch' && !window.matchMedia('(hover: none)').matches) show(); }}
      onMouseLeave={event => { props.onMouseLeave?.(event); hide(); }}
      onFocus={event => { props.onFocus?.(event); if (!skipFocus.current && !pinned.current) show(); }}
      onBlur={event => { props.onBlur?.(event); if (!pinned.current && !panel.current?.contains(event.relatedTarget as Node)) hide(); }}
      onClick={event => {
        props.onClick?.(event);
        if (shouldPreviewLink(event, pointerType.current, window.matchMedia('(hover: none) and (pointer: coarse)').matches) && show(true)) event.preventDefault();
        else if (!event.defaultPrevented) close();
      }}
    >{children}</a>
    {preview && createPortal(<div ref={panel} id={id} role="dialog" aria-label="Link preview" className="chat-link-preview"
      style={preview.touch ? {left:'50%',bottom:12,transform:'translateX(-50%)',maxHeight:'calc(100dvh - 24px)'} : { left: preview.left, top: preview.top, transform: preview.above ? "translateY(-100%)" : undefined }}
      onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide}
      onFocus={() => clearTimeout(timer.current)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== anchor.current) close(); }}>
      {preview.imageAllowed && <LinkThumbnail key={preview.url} url={preview.url} />}
      <span className="chat-link-preview-host">{preview.host}</span>
      <strong>{preview.title}</strong>
      <span className="chat-link-preview-url">{preview.url}</span>
      <div className="chat-link-preview-actions">
        <a ref={openLink} href={preview.url} target="_blank" rel="noopener noreferrer" onClick={() => close()}>Open link ↗</a>
        <button type="button" aria-label="Close link preview" onClick={() => close(true)}>Close</button>
      </div>
    </div>, document.body)}
  </>;
}
