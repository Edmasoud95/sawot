import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const {build}=createRequire(new URL('../package.json',import.meta.url))('esbuild');
let n=0;
async function fixture(permission='default', stored:any=null) {
 const bundle=await build({entryPoints:[new URL('../src/lib/pushNotifications.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}});
 let record=stored?JSON.stringify(stored):null;let requests=0;let subscriptions=0;let unsubscribe=0;let sub:any=null;const calls:any[]=[];
 const registration={pushManager:{getSubscription:async()=>sub,subscribe:async()=>{subscriptions++;sub={options:{applicationServerKey:new Uint8Array([1,2,3]).buffer},toJSON:()=>({endpoint:'vendor',keys:{}}),unsubscribe:async()=>{unsubscribe++;sub=null;return true;}};return sub;}}};
 Object.assign(globalThis,{window:{isSecureContext:true},localStorage:{getItem:()=>record,setItem:(_k:string,v:string)=>{record=v;}},Notification:{permission,requestPermission:async()=>{requests++;(globalThis as any).Notification.permission='granted';return 'granted';}},PushManager:function(){},location:{protocol:'https:',host:'sawot.test'}});
 Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration)}},configurable:true});
 globalThis.fetch=async(url,init:any={})=>{calls.push({url,init});return new Response(JSON.stringify(init.method==='POST'?{capability:'a'.repeat(43)}:init.method==='DELETE'?{}:{available:true,publicKey:'AQID'}));};
 const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+`\n// fixture ${n++}`).toString('base64')}`);
 return {api,calls,stats:()=>({requests,subscriptions,unsubscribe,record}),existing:async()=>registration.pushManager.subscribe()};
}
test('startup never prompts and deliberate enable targets only this device',async()=>{
 const f=await fixture();assert.equal((await f.api.initializeNotifications()).status,'disabled');assert.equal(f.stats().requests,0);
 assert.equal((await f.api.enableNotifications()).status,'enabled');assert.equal(f.stats().requests,1);assert.equal(f.api.getNotificationDevice(),'a'.repeat(43));
 assert.equal((await f.api.disableNotifications()).status,'disabled');assert.equal(f.api.getNotificationDevice(),undefined);assert.equal(f.stats().unsubscribe,1);
 assert.ok(f.calls.some(c=>c.init.method==='DELETE'));
});
test('permission denial and insecure context remain actionable without prompting',async()=>{
 const f=await fixture('denied');assert.equal((await f.api.initializeNotifications()).status,'blocked');assert.equal(f.stats().requests,0);
 (globalThis as any).window.isSecureContext=false;assert.equal((await f.api.initializeNotifications()).status,'unsupported');
});
test('existing permission and subscription recover missing local registration without prompting',async()=>{
 const f=await fixture('granted');await f.existing();assert.equal((await f.api.initializeNotifications()).status,'enabled');assert.equal(f.stats().requests,0);
});
test('registration failure never reports enabled',async()=>{
 const f=await fixture();const fetch=globalThis.fetch;globalThis.fetch=async(url,init:any)=>init?.method==='POST'?new Response('{}',{status:503}):fetch(url,init);
 assert.equal((await f.api.enableNotifications()).status,'error');assert.equal(f.api.getNotificationDevice(),undefined);
});
test('failed disable retains removal capability but immediately stops targeting',async()=>{
 const f=await fixture();await f.api.enableNotifications();globalThis.fetch=async()=>{throw Error('offline');};
 const pending=f.api.disableNotifications();assert.equal(f.api.getNotificationDevice(),undefined);assert.equal((await pending).status,'error');
 assert.equal(JSON.parse(f.stats().record!).capability,'a'.repeat(43));assert.equal(JSON.parse(f.stats().record!).enabled,false);
});

test('worker startup failure identifies the step without exposing raw browser errors',async()=>{
 const f=await fixture('granted');
 (navigator.serviceWorker as any).register=async()=>{throw new Error('private URL or subscription secret');};
 const result=await f.api.enableNotifications();
 assert.equal(result.status,'error');assert.match(result.message,/already allowed/i);assert.match(result.message,/service worker/i);
 assert.doesNotMatch(result.message,/private URL|subscription secret/);assert.equal(f.stats().requests,0);
});
test('push subscription failure distinguishes browser push from permission and server registration',async()=>{
 const f=await fixture('granted');
 const reg=await navigator.serviceWorker.ready;
 reg.pushManager.subscribe=async()=>{throw new DOMException('sensitive vendor response','AbortError');};
 const result=await f.api.enableNotifications();
 assert.equal(result.status,'error');assert.match(result.message,/browser push service/i);assert.match(result.message,/already allowed/i);
 assert.doesNotMatch(result.message,/sensitive vendor response/);assert.equal(f.calls.some(c=>c.init.method==='POST'),false);
});
test('server registration rejection reports the HTTP status and retains conflict recovery',async()=>{
 const f=await fixture('granted');const fetch=globalThis.fetch;let posts=0;
 globalThis.fetch=async(url,init:any)=>init?.method==='POST'?new Response('{}',{status:++posts===1?409:403}):fetch(url,init);
 const result=await f.api.enableNotifications();
 assert.equal(result.status,'error');assert.match(result.message,/403/);assert.match(result.message,/site address/i);
 assert.equal(posts,2);assert.equal(f.api.getNotificationDevice(),undefined);
});
test('server key fetch failure identifies connectivity rather than browser permission',async()=>{
 const f=await fixture('granted');globalThis.fetch=async()=>{throw new TypeError('private network URL');};
 const result=await f.api.enableNotifications();
 assert.equal(result.status,'error');assert.match(result.message,/reach SAWOT/i);assert.match(result.message,/already allowed/i);
 assert.doesNotMatch(result.message,/private network URL/);
});
test('rejected subscription reports safe host and key lengths without exposing credentials',async()=>{
 const f=await fixture('granted');const reg=await navigator.serviceWorker.ready;
 reg.pushManager.subscribe=async()=>({toJSON:()=>({endpoint:'https://example.test/private-device-token',keys:{p256dh:btoa('p'.repeat(65)),auth:btoa('a'.repeat(16))}})}) as any;
 const fetch=globalThis.fetch;globalThis.fetch=async(url,init:any)=>init?.method==='POST'?new Response(JSON.stringify({detail:'Unsupported or invalid push subscription'}),{status:400}):fetch(url,init);
 const result=await f.api.enableNotifications();
 assert.match(result.message,/example\.test/);assert.match(result.message,/65\/16/);
 assert.doesNotMatch(result.message,/private-device-token|cHBwcH|YWFhYW/);
});

test('retry reuses a matching browser subscription when local registration is missing',async()=>{
 const f=await fixture('granted');await f.existing();
 const result=await f.api.enableNotifications();
 assert.equal(result.status,'enabled');assert.equal(f.stats().subscriptions,1);assert.equal(f.stats().unsubscribe,0);
});
test('a stalled browser subscription times out and releases the setup queue',async(t)=>{
 const f=await fixture('granted');const reg=await navigator.serviceWorker.ready;const subscribe=reg.pushManager.subscribe;
 reg.pushManager.subscribe=()=>new Promise(()=>{});
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.api.enableNotifications();
 for(let i=0;i<100;i++)await Promise.resolve();
 t.mock.timers.tick(15000);
 const result=await pending;
 assert.equal(result.status,'error');assert.match(result.message,/timed out/i);assert.match(result.message,/browser push service/i);
 reg.pushManager.subscribe=subscribe;
 assert.equal((await f.api.enableNotifications()).status,'enabled');
});
test('a stalled service worker times out without leaving Updating active',async(t)=>{
 const f=await fixture('granted');
 Object.defineProperty(navigator.serviceWorker,'ready',{value:new Promise(()=>{}),configurable:true});
 t.mock.timers.enable({apis:['setTimeout']});
 const pending=f.api.enableNotifications();for(let i=0;i<30;i++)await Promise.resolve();
 t.mock.timers.tick(15000);
 const result=await pending;assert.equal(result.status,'error');assert.match(result.message,/timed out/i);assert.match(result.message,/service worker/i);
});
