import { useState } from "react";
import { updateVoiceSearch, voiceSearchStatus, type VoiceSearch } from "../../lib/voiceSearch";

function SourceIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string>();
  return <span className="chat-source-icon" aria-hidden="true">
    {src && failed !== src
      ? <img src={src} alt="" width="16" height="16" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="10" cy="10" r="7.5" /><ellipse cx="10" cy="10" rx="3.5" ry="7.5" /><path d="M2.5 10h15" />
      </svg>}
  </span>;
}

export default function ChatSources({ search }: { search?: VoiceSearch | null }) {
  if (!search) return null;
  // Revalidate stored metadata before making links or remote images clickable.
  const safe = updateVoiceSearch(null, { ...search, phase: "complete" });
  if (!safe) return null;
  const { status, busy } = voiceSearchStatus({ ...safe, phase: search.phase });
  const domains = [...new Map(safe.sources.map(source => [new URL(source.url).hostname, source])).values()];
  return <details className="chat-sources">
    <summary aria-label={`Web sources: ${status}`}>
      {domains.length > 0 && <span className="chat-source-icons">
        {domains.slice(0, 4).map(source => <SourceIcon key={source.url} src={source.favicon} />)}
      </span>}
      <span>{busy ? status : safe.sources.length ? `${safe.sources.length} sources` : status}</span>
      <svg className="chat-sources-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </summary>
    {(busy || search.phase === "error" || !safe.sources.length) && <p className="chat-sources-status" role="status">{status}</p>}
    {safe.sources.length > 0 && <ul>
      {safe.sources.map(source => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          <SourceIcon src={source.favicon} />
          <span className="chat-source-copy"><span className="chat-source-title">{source.title}</span><span className="chat-source-host">{new URL(source.url).hostname.replace(/^www\./, "")}{source.read && " · Read"}</span></span>
        </a>
      </li>)}
    </ul>}
  </details>;
}
