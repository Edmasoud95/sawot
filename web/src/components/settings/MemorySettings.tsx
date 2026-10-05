import { useCallback, useEffect, useRef, useState } from 'react';
import { invalidateMemory, memoryRequest, type MemoryFact } from '../../lib/memoryApi';
import { MemoryDialog, MemoryEditor } from '../chat/MemoryActivity';
import { BUTTON_CLS, FIELD_CLS, Toggle } from './fields';
export default function MemorySettings() {
  const [data, setData] = useState<{
      enabled: boolean;
      memories: MemoryFact[];
    } | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const close = useCallback(() => setConfirm(false), []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setData(null);
    try {
      const next = await memoryRequest<{
        enabled: boolean;
        memories: MemoryFact[];
      }>();
      if (request === generation.current) {
        setData(next);
        setError('');
      }
    } catch {
      if (request === generation.current) setError('Could not load memories. Please try again.');
    }
  }, []);
  useEffect(() => {
    const load = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    load();
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    window.addEventListener('sawot-memory-change', load);
    return () => {
      generation.current++;
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener('sawot-memory-change', load);
    };
  }, [refresh]);
  async function change(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await memoryRequest(path, path === '/clear' ? 'POST' : 'PATCH', body);
      invalidateMemory();
      setConfirm(false);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const matching = data?.memories.filter(f => f.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <section aria-label="Memory" className="min-w-0 space-y-3 border-t border-white/10 pt-5">
    <h3 className="text-sm text-zinc-200">Memory</h3>
    <p className="text-sm text-zinc-500">Chat can remember personal facts. Recalled facts are sent to your selected model provider. Disabling memory keeps saved facts and stops new capture and recall.</p>
    {error && <p role="alert" className="text-sm text-red-300">
      {error}
    </p>}
    {!data ? <button className={BUTTON_CLS} onClick={() => void refresh()}>Refresh memories</button> : <>
      <Toggle label="Remember in chat" hint="Applies to chat only." checked={data.enabled} onChange={enabled => {
        if (!busy) void change('/settings', {
          enabled
        });
      }} />
      <label className="block text-sm text-zinc-400">Search memories<input className={`${FIELD_CLS} mt-2 w-full`} type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <div className="max-h-80 space-y-4 overflow-y-auto">
        {matching.map(f => <div key={f.id} className="border-b border-white/10 pb-3">
          <MemoryEditor fact={f} onChange={() => void refresh()} />
        </div>)}
        {!matching.length && <p className="text-sm text-zinc-500">
          {data.memories.length ? 'No matching memories.' : 'No saved memories.'}
        </p>}
      </div>
    </>}
    <button ref={trigger} className={BUTTON_CLS} aria-disabled={busy || !data?.memories.length} onClick={() => {
      if (!busy && data?.memories.length) setConfirm(true);
    }}>Delete all memories</button>
    <p className="text-xs text-zinc-500">Deleting memories leaves original conversations and context already sent to providers.</p>
    {confirm && <MemoryDialog title="Delete all memories?" trigger={trigger} onClose={close}>
      <p className="mb-4 text-sm text-zinc-300">All saved facts will be deleted. This cannot be undone. Original conversations remain.</p>
      <div className="flex flex-wrap gap-2">
        <button className={BUTTON_CLS} disabled={busy} onClick={() => void change('/clear', {
          confirm: true
        })}>
          {busy ? 'Deleting…' : 'Delete all memories'}
        </button>
        <button className={BUTTON_CLS} disabled={busy} onClick={close}>Cancel</button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">
        {error}
      </p>}
    </MemoryDialog>}
  </section>;
}
