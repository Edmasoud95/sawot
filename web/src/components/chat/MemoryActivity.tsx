import { ActivityChevron, ActivityLabel } from "./ToolActivity";
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useChatStore } from '../../chatStore';
import { API_BASE } from '../../lib/config';
import { invalidateMemory, memoryRequest, type MemoryEvent, type MemoryFact } from '../../lib/memoryApi';
import { combinedMemoryFacts, groupMemoryEvents } from '../../lib/memoryActivity';
import { BUTTON_CLS, FIELD_CLS, Toggle } from '../settings/fields';
export function MemoryEditor({
  fact,
  onChange
}: {
  fact: MemoryFact;
  onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const [privateDraft, setPrivateDraft] = useState(fact.private === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(fact.text);
    setPrivateDraft(fact.private === true);
    setEditing(false);
    setError('');
  }, [fact.text, fact.revision, fact.private]);
  async function mutate(remove = false) {
    setBusy(true);
    setError('');
    try {
      await memoryRequest(`/${encodeURIComponent(fact.id)}`, remove ? 'DELETE' : 'PATCH', remove ? {
        revision: fact.revision
      } : {
        revision: fact.revision,
        text: draft.trim(),
        private: privateDraft
      });
      invalidateMemory();
      onChange();
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="space-y-2">
    {editing ? <>
      <textarea aria-label="Memory text" maxLength={1000} rows={4} className={`${FIELD_CLS} w-full resize-y`} value={draft} onChange={e => setDraft(e.target.value)} />
      <Toggle label="Private memory" hint="Only providers with private memory access can recall this fact." checked={privateDraft} onChange={value => { if (!busy) setPrivateDraft(value); }} />
      <button className={BUTTON_CLS} disabled={busy || !draft.trim()} onClick={() => void mutate()}>Save</button>
      <button className={BUTTON_CLS} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    </> : <>
      <p className="whitespace-pre-wrap break-words text-sm text-zinc-200">
        {fact.text}
      </p>
      {fact.private && <span className="text-xs text-zinc-400">Private memory</span>}
      <div className="flex flex-wrap gap-2">
        <button className={BUTTON_CLS} disabled={busy} onClick={() => { setDraft(fact.text); setPrivateDraft(fact.private === true); setEditing(true); }}>Edit</button>
        <button className={BUTTON_CLS} disabled={busy} onClick={() => void mutate(true)}>Delete memory</button>
      </div>
    </>}
    {error && <div className="space-y-2">
      <p role="alert" className="text-sm text-red-300">{error}</p>
      <button className={BUTTON_CLS} disabled={busy} onClick={onChange}>Reload saved memory</button>
    </div>}
  </div>;
}
export function MemoryDialog({
  title,
  trigger,
  onClose,
  children
}: {
  title: string;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useDialogFocus(true, panel, trigger, onClose);
  return createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={e => {
    if (e.target === e.currentTarget) onClose();
  }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={id} className="motion-reveal max-h-[85dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-ink-900 p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 id={id} className="text-zinc-100">
          {title}
        </h2>
        <button className={BUTTON_CLS} onClick={onClose} aria-label="Close memory dialog">Close</button>
      </div>
      {children}
    </div>
  </div>, document.body);
}
function ActivityButton({
  events
}: {
  events: MemoryEvent[];
}) {
  const event = events[0];
  const memories = combinedMemoryFacts(events);
  const eventIds = JSON.stringify([...new Set(events.map(event => event.id))]);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<MemoryEvent | null>(null);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const close = useCallback(() => {
    generation.current++;
    setOpen(false);
    setDetails(null);
    setError('');
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setDetails(null);
    setError('');
    try {
      const next = await Promise.all((JSON.parse(eventIds) as string[]).map(id => memoryRequest<MemoryEvent>(`/activity/${encodeURIComponent(id)}`)));
      if (request === generation.current) setDetails({...next[0], memories: combinedMemoryFacts(next)});
    } catch {
      if (request === generation.current) setError('This memory activity is unavailable.');
    }
  }, [eventIds]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => {
      if (live && document.visibilityState !== 'hidden') void refresh();
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('sawot-memory-change', load);
    return () => {
      live = false;
      generation.current++;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('sawot-memory-change', load);
    };
  }, [open, refresh]);
  const label = event.kind === 'recalled' ? `Memories recalled · ${memories.length}` : `Memory ${event.kind}`;
  async function source(fact: MemoryFact) {
    try {
      const response = await fetch(`${API_BASE}/api/chat/conversations/${encodeURIComponent(fact.sourceConversationId)}`, {
        cache: 'no-store'
      });
      if (!response.ok) throw Error();
      if (await useChatStore.getState().openConversation(fact.sourceConversationId)) close();else throw Error();
    } catch {
      setError('The source conversation is unavailable.');
    }
  }
  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)} className="tool-activity-row">
      <ActivityLabel kind="memory" label={event.kind === 'recalled' ? 'Memories recalled' : `Memory ${event.kind}`} detail={event.kind === 'recalled' ? String(memories.length) : undefined}/>
      <ActivityChevron/>
    </button>
    {open && <MemoryDialog title={label} trigger={trigger} onClose={close}>
      <p className="mb-3 text-xs text-zinc-500">
        {event.kind === 'recalled' ? 'These memories were supplied as context to the model.' : ''}
      </p>
      {error && <p role="alert" className="text-sm text-red-300">
        {error}
      </p>}
      {!details && !error && <p role="status">Loading…</p>}
      <div className="space-y-4">
        {details?.memories.map(m => <div key={JSON.stringify([m.id, m.revision])} className="space-y-2 border-t border-white/10 pt-3">
          {m.status !== 'active' || !m.current ? <p className="text-sm text-zinc-400">Memory deleted or unavailable.</p> : <>
            <p className="text-xs text-zinc-500">Saved {new Date(m.current.created).toLocaleDateString()}</p>
            <MemoryEditor fact={m.current} onChange={() => void refresh()} />
            {m.revision !== m.current.revision && <div className="text-xs text-zinc-500">
              <p>The memory has changed since this activity.</p>
              {m.text && <p className="whitespace-pre-wrap break-words">Previously supplied: {m.text}</p>}
            </div>}
            {/^(voice|live):/.test(m.current.sourceConversationId) ? <p className="text-xs text-zinc-500">Saved from a voice session.</p> : <button className={BUTTON_CLS} onClick={() => void source(m.current!)}>Open source conversation</button>}
          </>}
        </div>)}
      </div>
      <p className="mt-4 text-xs text-zinc-500">Deleting memory leaves original conversation messages and context already sent to a provider.</p>
    </MemoryDialog>}
  </>;
}
export default function MemoryActivity({
  events
}: {
  events: MemoryEvent[];
}) {
  return events?.length ? <div className="tool-activity my-3 flex flex-col items-start" aria-label="Memory activity">
    {groupMemoryEvents(events).map(group => <ActivityButton key={group[0].id} events={group} />)}
  </div> : null;
}
