import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
function worker(windows:any[]=[]){
 const handlers:any={};const notices:any[]=[];const opened:any[]=[];
 const self={location:{origin:'https://sawot.test'},addEventListener:(name:string,fn:any)=>{handlers[name]=fn;},registration:{showNotification:async(...args:any[])=>notices.push(args)},clients:{claim:async()=>{},matchAll:async()=>windows,openWindow:async(url:string)=>opened.push(url)},skipWaiting:async()=>{}};
 runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL});
 const dispatch=async(name:string,extra:any)=>{let p:any;handlers[name]({...extra,waitUntil:(v:any)=>{p=v;}});await p;};
 return {handlers,notices,opened,dispatch};
}
test('worker displays generic copy and stable tags without fetch interception',async()=>{
 const w=worker();const data={type:'chat-complete',conversationId:'abcdef123456',turnId:'turn-1'};
 await w.dispatch('push',{data:{json:()=>data}});await w.dispatch('push',{data:{json:()=>data}});
 assert.equal(w.notices[0][0],'SAWOT');assert.equal(w.notices[0][1].body,'Your response is ready.');assert.equal(w.notices[0][1].tag,'sawot-chat-turn-1');assert.equal(w.notices[1][1].tag,w.notices[0][1].tag);assert.equal(w.handlers.fetch,undefined);
 await w.dispatch('push',{data:{json:()=>({...data,conversationId:'https://evil.test'})}});assert.equal(w.notices.length,2);
});
test('click focuses existing same-origin window and sends only validated target',async()=>{
 let focused=0;const messages:any[]=[];const w=worker([{url:'https://evil.test',focus:()=>{throw Error('foreign');}},{url:'https://sawot.test/',focus:async()=>{focused++;},postMessage:(m:any)=>messages.push(m)}]);
 await w.dispatch('notificationclick',{notification:{close(){},data:{conversationId:'abcdef123456'}}});assert.equal(focused,1);assert.equal(messages[0].conversationId,'abcdef123456');assert.equal(w.opened.length,0);
});
test('cold click opens safe chat query and malformed targets do nothing',async()=>{
 const w=worker();await w.dispatch('notificationclick',{notification:{close(){},data:{conversationId:'abcdef123456'}}});assert.equal(w.opened[0],'https://sawot.test/?chat=abcdef123456');
 await w.dispatch('notificationclick',{notification:{close(){},data:{conversationId:'//evil.test'}}});assert.equal(w.opened.length,1);
});

test('worker uses the chat title and falls back for missing or blank titles',async()=>{
 const w=worker();
 for(const title of ['Weekend plans', undefined, '   ']){
  await w.dispatch('push',{data:{json:()=>({type:'chat-complete',conversationId:'abcdef123456',turnId:'title-test',title})}});
 }
 assert.deepEqual(w.notices.map(n=>n[0]),['Weekend plans','SAWOT','SAWOT']);
 assert.ok(w.notices.every(n=>n[1].body==='Your response is ready.'));
});
