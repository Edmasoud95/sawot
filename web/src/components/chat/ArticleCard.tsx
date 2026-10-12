import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { linkThumbnailUrl } from '../../lib/linkThumbnail';
import { ChatLinkSources } from './ChatLink';
import type { Product } from '../../lib/productCards';

// Keep automatic cards below the thumbnail endpoint's concurrent-request limit.
let active = 0;
const waiting: (() => void)[] = [];
async function thumbnail(url: string, signal: AbortSignal) {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else active++;
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('No article image');
    return await response.blob();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export default function ArticleCard({ href, children, product }: { href: string; children: ReactNode; product?: Product }) {
  const sources = useContext(ChatLinkSources);
  const source = sources.find(item => item.url.split('#')[0] === href.split('#')[0]);
  const thumbnailUrl = linkThumbnailUrl(href, source);
  const frame = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<string>();
  const [failed, setFailed] = useState(false);
  const host = new URL(href).hostname.replace(/^www\./, '');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let started = false;
    setImage(undefined); setFailed(false);
    const load = () => {
      if (started) return;
      started = true;
      void thumbnail(thumbnailUrl, controller.signal).then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '200px' });
    if (observer) observer.observe(frame.current!);
    else load();
    return () => { observer?.disconnect(); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [thumbnailUrl]);
  return <a className={product ? 'chat-article-card chat-product-card' : 'chat-article-card'} href={href} target="_blank" rel="noopener noreferrer">
    <span ref={frame} className="chat-article-picture" data-state={failed ? 'failed' : image ? 'loaded' : 'loading'} aria-hidden="true">
      {image && !failed ? <img src={image} alt="" decoding="async" onError={() => setFailed(true)} /> :
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
          {product ? <><path d="M5 8h14l1 12H4L5 8Z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></> :
            <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M7 16h4M14 12h3v4h-3z"/></>}
        </svg>}
    </span>
    <span className="chat-article-copy">
      <span className="chat-article-host">{host}</span>
      <span className="chat-article-title">{product?.title || source?.title || children || host}</span>
      {product?.price && <span className="chat-product-price">{product.price}</span>}
      {product?.description && <span className="chat-product-description">{product.description}</span>}
    </span>
    <svg className="chat-article-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>
  </a>;
}
