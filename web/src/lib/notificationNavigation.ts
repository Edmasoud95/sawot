import { useChatStore } from '../chatStore';
import { useVoiceStore } from '../store';
let pending: string | null = null;
let version = 0;
let running: Promise<boolean> | null = null;
let initialized = false;
const safeChat = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);
export const hasPendingNotificationTarget = () => pending !== null;
// A completed target must also win over a delayed mobile startup callback.
export const notificationNavigationVersion = () => version;
function select(id: string) {
  if (pending === id) return;
  pending = id; version++;
  useVoiceStore.getState().setMode('chat');
}
export function openPendingNotificationTarget(): Promise<boolean> {
  if (running) return running;
  if (!pending) return Promise.resolve(false);
  running = (async () => {
    while (pending) {
      const target = pending;
      const opened = await useChatStore.getState().openConversation(target);
      if (pending !== target) continue;
      if (!opened) {
        useChatStore.setState({ messageError: 'Could not open the notification conversation. Reconnect to SAWOT and return to retry.' });
        return false;
      }
      pending = null;
      const url = new URL(location.href);
      if (url.searchParams.has('chat')) {
        url.searchParams.delete('chat');
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      return true;
    }
    return false;
  })().finally(() => { running = null; });
  return running;
}
export function initializeNotificationNavigation(): () => void {
  if (initialized) return () => {};
  initialized = true;
  const id = new URL(location.href).searchParams.get('chat');
  if (safeChat(id)) select(id);
  const receive = (event: MessageEvent) => {
    if (event.data?.type !== 'open-chat' || !safeChat(event.data.conversationId)) return;
    select(event.data.conversationId);
    void openPendingNotificationTarget();
  };
  const resume = () => { if (document.visibilityState === 'visible') void openPendingNotificationTarget(); };
  navigator.serviceWorker?.addEventListener('message', receive);
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  return () => {
    initialized = false;
    navigator.serviceWorker?.removeEventListener('message', receive);
    window.removeEventListener('online', resume);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
  };
}
