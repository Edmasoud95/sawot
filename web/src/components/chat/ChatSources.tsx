import { ActivityChevron, ActivityLabel } from "./ToolActivity";
import { useState } from "react";
import ChatLink, { ChatLinkSources } from "./ChatLink";
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
  const query = updateVoiceSearch(safe, search)?.query;
  return <details className="chat-sources tool-activity" data-error={search.phase === "error" || undefined} data-searching={Boolean(query)}>
    <summary className="tool-activity-row" aria-label={`Web sources: ${status}${query ? ` ${query}` : ""}`}>
      <span className="tool-activity-content" role={busy ? "status" : undefined} aria-atomic="true">
        <ActivityLabel kind="search" label={busy ? status : "Web search"} detail={query || (!busy ? status : undefined)} busy={busy}/>
      </span>
      <ActivityChevron/>
    </summary>
    {!query && (busy || search.phase === "error" || !safe.sources.length) && <p className="chat-sources-status" role="status">{status}</p>}
    {safe.sources.length > 0 && <ChatLinkSources.Provider value={safe.sources}><ul>
      {safe.sources.map(source => <li key={source.url}>
        <ChatLink href={source.url}>
          <SourceIcon src={source.favicon} />
          <span className="chat-source-copy"><span className="chat-source-title">{source.title}</span><span className="chat-source-host">{new URL(source.url).hostname.replace(/^www\./, "")}{source.read && " · Read"}</span></span>
        </ChatLink>
      </li>)}
    </ul></ChatLinkSources.Provider>}
  </details>;
}
