import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createECDH, ECDH, randomBytes } from 'node:crypto';
import { request } from 'node:https';
import webPush from 'web-push';

export type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };
export type ChatCompletionNotice = { conversationId: string; turnId: string; notificationDevice: string; title?: string };
type RecordData = { subscription: PushSubscriptionData; version: string };
type State = { version: 1; keys: { publicKey: string; privateKey: string }; devices: Record<string, RecordData> };
type Options = { timeout: number; TTL: number; vapidDetails: { subject: string; publicKey: string; privateKey: string } };
type Dependencies = {
  isConversationAvailable?: (conversationId: string) => boolean;
  send?: (subscription: PushSubscriptionData, payload: string, options: Options) => Promise<unknown>;
  schedule?: (job: () => Promise<void>) => void;
  delay?: (ms: number) => Promise<void>;
  log?: (event: { outcome: string; turnId: string; status?: number }) => void;
};
const token = () => randomBytes(32).toString('base64url');
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
function keyBytes(value: unknown, length: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error('Invalid push subscription');
  const data = Buffer.from(value, 'base64url');
  if (data.length !== length) throw new Error('Invalid push subscription');
  return data;
}
export function validateSubscription(input: unknown): PushSubscriptionData {
  try {
    const value = input as PushSubscriptionData;
    if (typeof value?.endpoint !== 'string' || value.endpoint.length > 4096) throw 0;
    const url = new URL(value.endpoint);
    // Chromium also issues subscriptions on this Google staging endpoint.
    // Preserve the browser's URL: staging and production tokens are not interchangeable.
    const allowed = ['fcm.googleapis.com', 'jmt17.google.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
      || url.hostname.endsWith('.web.push.apple.com');
    if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw 0;
    const p256dh = keyBytes(value.keys?.p256dh, 65);
    if (p256dh[0] !== 4) throw 0;
    ECDH.convertKey(p256dh, 'prime256v1');
    keyBytes(value.keys?.auth, 16);
    return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
  } catch { throw new Error('Invalid push subscription'); }
}

// Native HTTPS gives a wall-clock deadline and never follows redirects.
async function send(subscription: PushSubscriptionData, payload: string, options: Options): Promise<void> {
  const details = webPush.generateRequestDetails(subscription, payload, options);
  await new Promise<void>((resolve, reject) => {
    const req = request(details.endpoint, { method: details.method, headers: details.headers }, res => {
      res.resume();
      const statusCode = res.statusCode ?? 0;
      clearTimeout(timer);
      if (statusCode >= 200 && statusCode < 300) resolve();
      else reject({ statusCode });
      res.destroy();
    });
    const timer = setTimeout(() => req.destroy(new Error('Push timeout')), options.timeout);
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end(details.body);
  });
}

export class PushNotifications {
  private state: State;
  private pending = 0;
  constructor(private file: string, private subject = 'https://github.com/Edmasoud95/sawot', private deps: Dependencies = {}) {
    try {
      const contact = new URL(subject);
      if (!['https:', 'mailto:'].includes(contact.protocol) || contact.username || contact.password) throw 0;
      if (existsSync(file)) {
        const state = JSON.parse(readFileSync(file, 'utf8')) as State;
        if (state.version !== 1 || !state.devices || Object.keys(state.devices).length > 100) throw 0;
        const privateKey = keyBytes(state.keys.privateKey, 32);
        const curve = createECDH('prime256v1'); curve.setPrivateKey(privateKey);
        if (curve.getPublicKey().toString('base64url') !== state.keys.publicKey) throw 0;
        for (const [cap, record] of Object.entries(state.devices)) {
          if (!CAPABILITY.test(cap) || !CAPABILITY.test(record.version)) throw 0;
          record.subscription = validateSubscription(record.subscription);
        }
        this.state = state;
        chmodSync(file, 0o600);
      } else {
        this.state = { version: 1, keys: webPush.generateVAPIDKeys(), devices: {} };
        this.save(this.state);
      }
    } catch { throw new Error('Response notifications unavailable: private storage or configuration is invalid'); }
  }
  publicKey(): string { return this.state.keys.publicKey; }
  private save(next: State): void {
    const temp = `${this.file}.${token()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      renameSync(temp, this.file);
      this.state = next;
    } catch { throw new Error('Response notification storage unavailable'); }
    finally { rmSync(temp, { force: true }); }
  }
  register(input: PushSubscriptionData, capability?: string): string {
    const subscription = validateSubscription(input);
    const existing = capability && CAPABILITY.test(capability) && this.state.devices[capability];
    const cap = existing ? capability! : token();
    if (Object.entries(this.state.devices).some(([id, record]) => id !== cap && record.subscription.endpoint === subscription.endpoint)) {
      throw new Error('Push subscription already registered; disable and enable notifications on this device');
    }
    if (!existing && Object.keys(this.state.devices).length >= 100) throw new Error('Push registration limit reached');
    this.save({ ...this.state, devices: { ...this.state.devices, [cap]: { subscription, version: token() } } });
    return cap;
  }
  remove(capability: string): void {
    if (!CAPABILITY.test(capability) || !Object.hasOwn(this.state.devices, capability)) return;
    const devices = { ...this.state.devices }; delete devices[capability];
    this.save({ ...this.state, devices });
  }
  enqueue(notice: ChatCompletionNotice): void {
    if (!CAPABILITY.test(notice.notificationDevice) || !/^[a-f0-9]{12}$/.test(notice.conversationId)
      || !/^[A-Za-z0-9_-]{1,64}$/.test(notice.turnId) || !this.state.devices[notice.notificationDevice]) return;
    const log = (outcome: string, status?: number) => {
      try { this.deps.log?.({ outcome, turnId: notice.turnId, ...(status ? { status } : {}) }); } catch { /* logging cannot fail chat */ }
    };
    if (this.pending >= 100) { log('queue-full'); return; }
    this.pending++;
    const job = async () => {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (this.deps.isConversationAvailable && !this.deps.isConversationAvailable(notice.conversationId)) return;
          const record = this.state.devices[notice.notificationDevice];
          if (!record) return;
          try {
            await (this.deps.send ?? send)(record.subscription, JSON.stringify({ type: 'chat-complete', conversationId: notice.conversationId, turnId: notice.turnId,
              title: notice.title?.trim().slice(0, 80) || 'SAWOT' }),
              { timeout: 5000, TTL: 3600, vapidDetails: { subject: this.subject, ...this.state.keys } });
            log('sent'); return;
          } catch (error: any) {
            const status = typeof error?.statusCode === 'number' ? error.statusCode : undefined;
            if ((status === 404 || status === 410) && this.state.devices[notice.notificationDevice]?.version === record.version) {
              this.remove(notice.notificationDevice);
            }
            if (attempt === 0 && (!status || status === 429 || status >= 500)) {
              await (this.deps.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
            } else { log('failed', status); return; }
          }
        }
      } catch { log('failed'); }
      finally { this.pending--; }
    };
    try { (this.deps.schedule ?? (job => { setImmediate(() => { void job(); }); }))(job); }
    catch { this.pending--; log('failed'); }
  }
}
