import { API_BASE } from './config';
export type NotificationState = { status: 'unsupported' | 'disabled' | 'enabled' | 'blocked' | 'busy' | 'error'; message?: string };
type Device = { enabled: boolean; capability?: string };
const KEY = 'sawot-notifications';
let state: NotificationState = { status: 'disabled' };
const listeners = new Set<() => void>();
let chain = Promise.resolve<unknown>(undefined);
let revision = 0;
function stored(): Device | null {
  try { const value = JSON.parse(localStorage.getItem(KEY)); return typeof value?.enabled === 'boolean' ? value : null; } catch { return null; }
}
function save(device: Device) { localStorage.setItem(KEY, JSON.stringify(device)); }
function publish(value: NotificationState): NotificationState { state = value; listeners.forEach(fn => fn()); return value; }
export const notificationSnapshot = () => state;
export const subscribeNotifications = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function supported() {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator && typeof PushManager !== 'undefined' && typeof Notification !== 'undefined';
}
// Only our own safe messages reach the UI; browser/vendor errors can contain
// subscription URLs or other private registration details.
class NotificationSetupError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}
async function setupStep<T>(message: string, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NotificationSetupError(`The browser operation timed out. ${message}`)), 15000);
  });
  try { return await Promise.race([work(), deadline]); }
  catch (error) { throw error instanceof NotificationSetupError ? error : new NotificationSetupError(message); }
  finally { clearTimeout(timer!); }
}
function subscriptionSummary(body: unknown): string {
  const subscription = (body as { subscription?: PushSubscriptionJSON })?.subscription;
  let host = 'invalid endpoint';
  try { host = new URL(subscription?.endpoint ?? '').hostname; } catch { /* Do not expose the raw endpoint. */ }
  const bytes = (key: unknown) => {
    try { return typeof key === 'string' ? atob(key.replace(/-/g, '+').replace(/_/g, '/')).length : 0; }
    catch { return 0; }
  };
  return `Push service: ${host}; key bytes: ${bytes(subscription?.keys?.p256dh)}/${bytes(subscription?.keys?.auth)}.`;
}
function enqueue(work: () => Promise<NotificationState>): Promise<NotificationState> {
  const result = chain.then(work, work).catch(error => {
    const allowed = typeof Notification !== 'undefined' && Notification.permission === 'granted';
    const detail = error instanceof NotificationSetupError ? error.message
      : 'Could not update notifications. Check your connection and browser push settings, then retry.';
    return publish({ status: 'error', message: `${allowed ? 'Notifications are already allowed in your browser. ' : ''}${detail}` });
  });
  chain = result; return result;
}
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API_BASE}/api/notifications/${path}`, { method, cache: 'no-store', signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (!res.ok) {
      const detail = res.status === 403 ? 'SAWOT rejected this site address. Check the server’s allowed origins.'
        : res.status === 400 ? `SAWOT rejected the browser’s push subscription. ${subscriptionSummary(body)}`
        : res.status === 429 ? 'SAWOT has reached its notification device limit.'
        : 'SAWOT could not complete the notification registration request.';
      throw new NotificationSetupError(`${detail} (HTTP ${res.status})`, res.status);
    }
    return res.status === 204 ? null : await res.json();
  } catch (error) {
    if (error instanceof NotificationSetupError) throw error;
    throw new NotificationSetupError('Could not reach SAWOT’s notification service or read its response. Check your connection and retry.');
  } finally { clearTimeout(timer); }
}
async function registration() {
  return setupStep('SAWOT’s notification service worker could not start. Check that this site has a trusted HTTPS connection, then reload and retry.', async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    // The ready promise waits for an active worker before calling PushManager.
    return navigator.serviceWorker.ready;
  });
}
function applicationKey(key: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function matchesKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((value, index) => value === key[index]);
}
function readSubscription(reg: ServiceWorkerRegistration) {
  return setupStep('The browser could not read its push subscription. Reload this page and retry.', () => reg.pushManager.getSubscription());
}
async function unsubscribe(sub: PushSubscription) {
  const message = 'The browser could not reset its push subscription. Reload this page and retry.';
  if (!await setupStep(message, () => sub.unsubscribe())) throw new NotificationSetupError(message);
}
async function connect(reg: ServiceWorkerRegistration, current: Device | null, expectedRevision: number): Promise<NotificationState> {
  const info = await api('key');
  if (!info.available || !info.publicKey) throw new NotificationSetupError('Notifications are unavailable on the SAWOT server. Check its notification configuration.');
  const key = applicationKey(info.publicKey);
  let sub = await readSubscription(reg);
  if (sub && !matchesKey(sub, key)) {
    await unsubscribe(sub);
    sub = null;
  }
  const subscribe = () => setupStep('The browser push service could not create a subscription. Check your browser’s push messaging settings and internet connection, then retry.',
    () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  sub ??= await subscribe();
  let result: { capability: string };
  try { result = await api('subscription', 'POST', { subscription: sub.toJSON(), capability: current?.capability }); }
  catch (error: any) {
    if (error.status !== 409) throw error;
    await unsubscribe(sub);
    sub = await subscribe();
    result = await api('subscription', 'POST', { subscription: sub.toJSON(), capability: current?.capability });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(result.capability)) throw new Error('Invalid registration');
  // A disable click while permission/registration was pending wins, but retain
  // the capability so the queued disable can remove the new registration.
  save({ enabled: expectedRevision === revision, capability: result.capability });
  if (expectedRevision !== revision) return state;
  return publish({ status: 'enabled' });
}
export function getNotificationDevice(): string | undefined {
  if (!supported() || Notification.permission !== 'granted') return undefined;
  const device = stored();
  return device?.enabled && /^[A-Za-z0-9_-]{43}$/.test(device.capability ?? '') ? device.capability : undefined;
}
export function initializeNotifications(): Promise<NotificationState> {
  const expectedRevision = revision;
  return enqueue(async () => {
    if (!supported()) return publish({ status: 'unsupported', message: 'Notifications need a supported browser and a trusted HTTPS connection. On iPhone, open SAWOT from the Home Screen.' });
    const device = stored();
    if (Notification.permission === 'denied') return publish({ status: 'blocked', message: 'Allow notifications for SAWOT in browser site settings and Android notification settings.' });
    if (expectedRevision !== revision) return state;
    if (device?.enabled === false) {
      if (device.capability) return cleanup(device);
      return publish({ status: 'disabled' });
    }
    if (Notification.permission !== 'granted') return publish({ status: 'disabled' });
    const reg = await registration();
    if (!device?.enabled && !await readSubscription(reg)) return publish({ status: 'disabled' });
    return connect(reg, device, expectedRevision);
  });
}
export function enableNotifications(): Promise<NotificationState> {
  if (!supported()) return initializeNotifications();
  if (Notification.permission === 'denied') return initializeNotifications();
  const expectedRevision = ++revision;
  // Start the browser prompt directly in the click handler's activation context.
  const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
  publish({ status: 'busy' });
  return enqueue(async () => {
    if (await permission !== 'granted') return publish({ status: Notification.permission === 'denied' ? 'blocked' : 'disabled', message: 'Notifications were not allowed. You can change this in browser site settings.' });
    if (expectedRevision !== revision) return state;
    const device = stored(); save({ ...device, enabled: true });
    return connect(await registration(), device, expectedRevision);
  });
}
async function cleanup(device: Device): Promise<NotificationState> {
  let failed = false;
  try {
    const reg = await setupStep('The browser could not find its notification service worker. Reload this page and retry.',
      async () => navigator.serviceWorker.getRegistration?.('/')) ?? await registration();
    const sub = await readSubscription(reg);
    if (sub) await unsubscribe(sub);
  } catch { failed = true; }
  try { if (device.capability) await api('subscription', 'DELETE', { capability: device.capability }); }
  catch { failed = true; }
  if (failed) throw new Error('Notification removal pending');
  save({ enabled: false }); return publish({ status: 'disabled' });
}
export function disableNotifications(): Promise<NotificationState> {
  ++revision;
  try { save({ ...stored(), enabled: false }); }
  catch { return Promise.resolve(publish({ status: 'error', message: 'Allow site storage to save your notification preference.' })); }
  publish({ status: 'busy' });
  return enqueue(() => cleanup(stored()!));
}
