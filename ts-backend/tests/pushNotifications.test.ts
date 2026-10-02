import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createECDH } from 'node:crypto';
import { PushNotifications, validateSubscription } from '../src/pushNotifications.js';

const key = createECDH('prime256v1'); key.generateKeys();
const sub = (id = 'a') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } });
function fixture(t: any, deps: any = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sawot-push-')); t.after(() => rmSync(dir, {recursive:true, force:true}));
  const file = join(dir, 'push.json');
  const jobs: (() => Promise<void>)[] = [];
  const service = new PushNotifications(file, undefined, { schedule: (job: () => Promise<void>) => jobs.push(job), ...deps });
  return { service, file, jobs };
}
const notice = (notificationDevice: string) => ({ conversationId: 'abcdef123456', turnId: 'turn-1', title: 'Weekend plans', notificationDevice });

test('keys survive restart and private file is restrictive', t => {
  const {service,file} = fixture(t);
  const cap = service.register(sub());
  assert.match(cap, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const restarted = new PushNotifications(file);
  assert.equal(restarted.publicKey(), service.publicKey());
  assert.equal(restarted.register(sub(),cap),cap);
  assert.throws(() => restarted.register(sub()), /already registered/);
});
test('invalid subscriptions are rejected', () => {
  for (const endpoint of ['http://fcm.googleapis.com/a','https://localhost/a','https://fcm.googleapis.com.evil.test/a','https://a@fcm.googleapis.com/a','https://fcm.googleapis.com:8443/a','https://fcm.googleapis.com/a#x']) {
    assert.throws(() => validateSubscription({...sub(),endpoint}), /subscription/);
  }
  assert.throws(() => validateSubscription({...sub(), keys:{...sub().keys,auth:'x'}}));
  assert.throws(() => validateSubscription({...sub(), keys:{...sub().keys,p256dh:Buffer.alloc(65,4).toString('base64url')}}));
});
test('registration limit preserves existing devices', t => {
  const {service} = fixture(t); const cap=service.register(sub());
  for(let i=1;i<100;i++) service.register(sub(String(i)));
  assert.throws(() => service.register(sub('overflow')), /limit/);
  assert.equal(service.register(sub('refresh'),cap),cap);
});
test('corrupt storage is not overwritten', t => {
  const {file}=fixture(t); writeFileSync(file,'broken');
  assert.throws(() => new PushNotifications(file), /unavailable/);
  assert.equal(readFileSync(file,'utf8'),'broken');
});
test('delivery includes the chat title, is targeted and bounded, and retries once', async t => {
  const calls: any[]=[]; const logs: any[]=[];
  const {service,jobs}=fixture(t,{send:async (...args:any[])=>{calls.push(args);throw {statusCode:503,body:'SECRET'};},delay:async()=>{},log:(x:any)=>logs.push(x)});
  const cap=service.register(sub()); service.register(sub('other'));
  service.enqueue(notice(cap)); assert.equal(calls.length,0);
  await jobs.shift()!();
  assert.equal(calls.length,2);
  assert.equal(calls[0][0].endpoint,sub().endpoint);
  assert.deepEqual(JSON.parse(calls[0][1]),{type:'chat-complete',conversationId:'abcdef123456',turnId:'turn-1',title:'Weekend plans'});
  assert.equal(calls[0][2].timeout,5000); assert.equal(calls[0][2].TTL,3600);
  assert.ok(!JSON.stringify(logs).includes('SECRET')); assert.ok(!JSON.stringify(logs).includes(cap));
});
test('disabled queued recipient is skipped', async t => {
  let sends=0; const {service,jobs}=fixture(t,{send:async()=>{sends++;}});
  const cap=service.register(sub()); service.enqueue(notice(cap)); service.remove(cap);
  await jobs.shift()!(); assert.equal(sends,0);
});
test('expiry removes only matching subscription version', async t => {
  let release!:()=>void;
  const {service,jobs}=fixture(t,{send:()=>new Promise((_resolve,reject)=>{release=()=>reject({statusCode:410});})});
  const cap=service.register(sub()); service.enqueue(notice(cap)); const sending=jobs.shift()!();
  service.register(sub('replacement'),cap); release(); await sending;
  assert.equal(service.register(sub('replacement'),cap),cap);
});
test('expired subscription is removed and permanent failures are not retried', async t => {
  let sends=0; const {service,jobs}=fixture(t,{send:async()=>{sends++;throw {statusCode:410};}});
  const cap=service.register(sub()); service.enqueue(notice(cap)); await jobs.shift()!();
  assert.equal(sends,1); assert.notEqual(service.register(sub()),cap);
});
test('deleted conversation is skipped at dispatch and before retry', async t => {
  let exists=true;let sends=0;
  const {service,jobs}=fixture(t,{isConversationAvailable:()=>exists,send:async()=>{sends++;throw {statusCode:503};},delay:async()=>{exists=false;}});
  const cap=service.register(sub());service.enqueue(notice(cap));exists=false;await jobs.shift()!();assert.equal(sends,0);
  exists=true;service.enqueue(notice(cap));await jobs.shift()!();assert.equal(sends,1);
});

test('Chromium staging push endpoint is accepted and preserved for delivery', async t => {
  const subscription = { ...sub(), endpoint: 'https://jmt17.google.com/fcm/send/test-token' };
  assert.deepEqual(validateSubscription(subscription), subscription);
  const endpoints: string[] = [];
  const { service, jobs, file } = fixture(t, { send: async (value: any) => { endpoints.push(value.endpoint); } });
  const capability = service.register(subscription);
  assert.equal(new PushNotifications(file).register(subscription, capability), capability);
  service.enqueue(notice(capability));
  await jobs.shift()!();
  assert.deepEqual(endpoints, [subscription.endpoint]);
  for (const endpoint of ['https://jmt17.google.com.evil.test/fcm/send/a', 'https://evil.jmt17.google.com/fcm/send/a', 'https://other.google.com/fcm/send/a', 'http://jmt17.google.com/fcm/send/a', 'https://jmt17.google.com:8443/fcm/send/a']) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }), /subscription/);
  }
});
