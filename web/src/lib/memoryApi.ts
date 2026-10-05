import { useChatStore } from '../chatStore';
import { API_BASE } from './config';
export interface MemoryFact {
  id: string;
  revision: number;
  text: string;
  sourceConversationId: string;
  sourceMessageId: string;
  created: string;
  updated: string;
}
export interface MemoryEvent {
  id: string;
  kind: 'saved' | 'updated' | 'recalled' | 'deleted';
  created: string;
  memories: Array<Partial<MemoryFact> & {
    id: string;
    revision: number;
    status?: 'active' | 'deleted';
    current?: MemoryFact;
  }>;
}
export async function memoryRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}/api/memory${path}`, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : {
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const message = failure.message || failure.error;
    throw new Error(response.status === 409 ? 'This memory changed. Refresh and try again.' : response.status === 404 ? 'This memory is unavailable.' : response.status === 400 && typeof message === 'string' ? message.slice(0, 200) : 'Could not update memories. Please try again.');
  }
  return response.json();
}
// Events retain identity and counts only in browser state. Details always come from the server.
export function invalidateMemory() {
  const strip = (events: MemoryEvent[] | undefined) => (events ?? []).map(e => ({
    ...e,
    memories: e.memories.map(m => ({
      id: m.id,
      revision: m.revision
    }))
  }));
  useChatStore.setState(s => ({
    streamMemory: strip(s.streamMemory),
    active: s.active ? {
      ...s.active,
      messages: s.active.messages.map(m => ({
        ...m,
        memory: strip(m.memory)
      }))
    } : s.active
  }));
  window.dispatchEvent(new Event('sawot-memory-change'));
}
