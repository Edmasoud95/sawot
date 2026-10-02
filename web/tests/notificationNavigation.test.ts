import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const {build}=createRequire(new URL('../package.json',import.meta.url))('esbuild');
let fixtureId=0;
async function fixture(query='?chat=abcdef123456') {
 const root=new URL('../src/',import.meta.url).pathname;
 const bundle=await build({stdin:{contents:`export * from './lib/notificationNavigation'; export {useChatStore} from './chatStore'; export {useVoiceStore} from './store';`,resolveDir:root},bundle:true,write:false,platform:'node',format:'esm',define:{'import.meta.env':'{}'}});
 const windowTarget=new EventTarget();const worker=new EventTarget();const location=new URL(`https://sawot.test/${query}`);const urls:string[]=[];
 Object.assign(globalThis,{window:Object.assign(windowTarget,{matchMedia:()=>({matches:true})}),location,history:{replaceState:(_a:any,_b:any,url:string)=>{urls.push(url);}},localStorage:{getItem:()=>null,setItem:()=>{}},document:{visibilityState:'visible'}});
 Object.defineProperty(globalThis,'navigator',{value:{serviceWorker:worker},configurable:true});
 const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text+`\n//${fixtureId++}`).toString('base64')}`);
 const requests:any[]=[];
 globalThis.fetch=async(url,init:any={})=>{requests.push({url,init});return new Response(JSON.stringify({id:String(url).split('/').at(-1),messages:[],draftText:''}));};
 return {api,worker,urls,requests,windowTarget};
}
test('cold target opens chat once and prevents mobile auto-new after completion',async()=>{
 const f=await fixture();const cleanup=f.api.initializeNotificationNavigation();assert.equal(f.api.hasPendingNotificationTarget(),true);
 await f.api.openPendingNotificationTarget();assert.equal(f.api.useChatStore.getState().activeId,'abcdef123456');assert.equal(f.api.useVoiceStore.getState().mode,'chat');
 assert.equal(f.api.hasPendingNotificationTarget(),false);assert.equal(f.api.notificationNavigationVersion(),1);
 await f.api.openPendingNotificationTarget();assert.equal(f.requests.length,1);assert.equal(f.urls.length,1);cleanup();
});
test('worker navigation saves previous draft before opening target',async()=>{
 const f=await fixture('');const cleanup=f.api.initializeNotificationNavigation();const store=f.api.useChatStore;
 store.setState({activeId:'111111111111',active:{id:'111111111111',messages:[],draftText:''},conversations:[]});store.getState().setDraftText('Please keep my draft');
 f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'open-chat',conversationId:'abcdef123456'}}));
 await f.api.openPendingNotificationTarget();assert.equal(store.getState().activeId,'abcdef123456');assert.equal(f.requests[0].init.method,'PATCH');assert.equal(JSON.parse(f.requests[0].init.body).draftText,'Please keep my draft');cleanup();
});
test('offline target remains retryable and malformed messages cannot navigate',async()=>{
 const f=await fixture();const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline');};const cleanup=f.api.initializeNotificationNavigation();
 assert.equal(await f.api.openPendingNotificationTarget(),false);assert.equal(f.api.hasPendingNotificationTarget(),true);assert.equal(f.urls.length,0);
 globalThis.fetch=saved;assert.equal(await f.api.openPendingNotificationTarget(),true);assert.equal(f.api.useChatStore.getState().activeId,'abcdef123456');
 f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'open-chat',conversationId:'https://evil.test'}}));assert.equal(f.api.hasPendingNotificationTarget(),false);cleanup();
});
test('notification navigation preserves unsent attachments when returning to previous chat',async()=>{
 const f=await fixture('');const cleanup=f.api.initializeNotificationNavigation();const store=f.api.useChatStore;
 const attachment={id:'123456abcdef',name:'draft.png',kind:'image'};
 store.setState({activeId:'111111111111',active:{id:'111111111111',messages:[],draftText:''},pendingAttachments:[attachment],conversations:[]});
 f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'open-chat',conversationId:'abcdef123456'}}));await f.api.openPendingNotificationTarget();
 await store.getState().openConversation('111111111111');assert.deepEqual(store.getState().pendingAttachments,[attachment]);cleanup();
});
test('notification target wins when mobile new-chat POST is already in flight',async()=>{
 const f=await fixture('');const cleanup=f.api.initializeNotificationNavigation();const store=f.api.useChatStore;
 const original=globalThis.fetch;let release!:(value:Response)=>void;let started!:()=>void;
 const posting=new Promise<void>(resolve=>{started=resolve;});
 globalThis.fetch=async(url,init:any={})=>{if(init.method==='POST'){started();return new Promise(resolve=>{release=resolve;});}return original(url,init);};
 const startup=store.getState().newConversation();await posting;
 f.worker.dispatchEvent(new MessageEvent('message',{data:{type:'open-chat',conversationId:'abcdef123456'}}));await f.api.openPendingNotificationTarget();
 release(new Response(JSON.stringify({id:'111111111111',messages:[],title:'New chat'})));await startup;
 assert.equal(store.getState().activeId,'abcdef123456');assert.equal(f.api.hasPendingNotificationTarget(),false);cleanup();
});
