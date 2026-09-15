import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useVoiceStore } from "../store";
import { voiceSearchStatus, type VoiceSearch } from "../lib/voiceSearch";

function domain(url: string) {
  return new URL(url).hostname.replace(/^www\./, "");
}

function Favicon({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string>();
  return (
    <span className="voice-favicon" aria-hidden="true">
      {src && failed !== src ? (
        <img src={src} alt="" width="16" height="16" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      ) : (
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <circle cx="10" cy="10" r="7.5" /><ellipse cx="10" cy="10" rx="3.5" ry="7.5" /><path d="M2.5 10h15" />
        </svg>
      )}
    </span>
  );
}

export default function VoiceSources() {
  const search: VoiceSearch | null = useVoiceStore((s) => s.search);
  // Unmount the popover on a new recording, disconnect, or pipeline error.
  return search ? <SourceRow search={search} /> : null;
}

function SourceRow({ search }: { search: VoiceSearch }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const positionPanel = useCallback(() => {
    const top = trigger.current?.getBoundingClientRect().top ?? 0;
    panel.current?.style.setProperty("--source-row-top", `${top}px`);
  }, []);
  useEffect(() => {
    if (!open) return;
    positionPanel();
    window.addEventListener("resize", positionPanel);
    return () => window.removeEventListener("resize", positionPanel);
  }, [open, positionPanel]);

  const { busy, showSources, status } = voiceSearchStatus(search);
  const domains = [...new Set(search.sources.map(source => domain(source.url)))];
  const more = domains.length > 2 ? ` +${domains.length - 2}` : "";

  return (
    <div className="voice-sources">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{status}</span>
      <button
        ref={trigger}
        className="voice-sources-button"
        data-busy={busy}
        popoverTarget={id}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Web sources: ${status}`}
        onClick={positionPanel}
      >
        {!showSources && <span className="voice-search-dot" aria-hidden="true" />}
        {showSources ? (
          <span className="voice-source-domains">
            {domains.slice(0, 2).map(name => (
              <span className="voice-source-domain" key={name}>
                <Favicon src={search.sources.find(source => domain(source.url) === name && source.favicon)?.favicon} />
                <span className="voice-source-preview">{name}</span>
              </span>
            ))}
          </span>
        ) : <span className="voice-source-preview">{status}</span>}
        {showSources && more && <span>{more}</span>}
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" aria-hidden="true">
          <path d={open ? "m4 6 4 4 4-4" : "m4 10 4-4 4 4"} />
        </svg>
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="region"
        className="voice-sources-popover"
        aria-labelledby={`${id}-title`}
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        <div className="voice-sources-heading">
          <h2 id={`${id}-title`}>Web sources</h2>
          <button className="icon-button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close web sources" autoFocus>×</button>
        </div>
        {(busy || search.phase === "error" || !search.sources.length) && <p className="voice-sources-status">{status}</p>}
        {!!search.sources.length && (
          <ul className="voice-source-list">
            {search.sources.map(source => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  <span className="voice-source-title">{source.title}</span>
                  <span className="voice-source-meta"><Favicon src={source.favicon} /><span className="voice-source-host">{domain(source.url)}</span>{source.read && <span className="voice-source-read">Read</span>}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
