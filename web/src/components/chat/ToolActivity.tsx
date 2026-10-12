import type { ReactNode } from 'react';

export type ToolKind = 'search' | 'home' | 'code' | 'download' | 'memory' | 'tool';

export function ToolIcon({ kind }: { kind: ToolKind }) {
  return <svg className="tool-activity-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'search' ? <><path d="M19.5 9A8 8 0 1 0 9 19.5M4 7h14M3 12h7M5 17h4M11 3c-4 4-4 12-1 16M11 3c2 2 3 4 3 6"/><circle cx="16" cy="16" r="4"/><path d="m19 19 3 3"/></>
      : kind === 'home' ? <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z M12 20v-6m0 2-5-4m5 2 5-4"/><circle cx="7" cy="11" r="1"/><circle cx="17" cy="9" r="1"/></>
      : kind === 'code' ? <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></>
      : kind === 'download' ? <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></>
      : kind === 'memory' ? <><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z M9 7h6m-6 4h4"/></>
      : <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></>}
  </svg>;
}

export function ActivityChevron() {
  return <svg className="tool-activity-chevron" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 6 3 3 3-3"/></svg>;
}

export function ActivityLabel({ kind, label, detail, busy = false }: { kind: ToolKind; label: string; detail?: ReactNode; busy?: boolean }) {
  return <><ToolIcon kind={kind}/><span className="tool-activity-copy"><span className={`tool-activity-label${busy ? ' thinking-shimmer' : ''}`}>{label}</span>{detail && <span className="tool-activity-detail">{detail}</span>}</span></>;
}
