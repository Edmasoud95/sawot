import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ChatStore } from '../src/chat.js';
import { registerChatRoutes, type ChatCtx } from '../src/chatRoutes.js';
import { MemoryStore } from '../src/memory/store.js';
import { buildMemoryTools } from '../src/memory/tools.js';
const events=(body:string)=>body.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
async function* chunks(delta:any){yield {choices:[{delta}]};}
async function harness(t:any, prepareSpeech?: ChatCtx["prepareSpeech"]){
 const root=await mkdtemp(join(tmpdir(),'sawot-private-chat-'));const memory=new MemoryStore(root);await memory.init();const store=new ChatStore(join(root,'chats'));
 let trusted=true,speechPrivate=false,speechCalls=0;const requests:any[]=[];const watchers=new Set<()=>void>();
 const app=Fastify();
 registerChatRoutes(app,{memory,store,prepareSpeech,resolve:model=>({model,client:{chat:{completions:{create:async(request:any)=>{
  requests.push({model,request:structuredClone(request)});
  return chunks(request.messages.some((m:any)=>m.role==='tool')?{content:'Answer using recalled facts.'}:{tool_calls:[{index:0,id:'recall',function:{name:'search_memories',arguments:'{"query":"city"}'}}]});
 }}}}}),isPrivateProvider:model=>model==='local::test'&&trusted,isPrivateSpeechProvider:()=>speechPrivate,
 subscribeProviderPrivacy:listener=>{watchers.add(listener);return()=>{watchers.delete(listener);};},
 synthesize:async()=>{speechCalls++;return Buffer.from('wav');},haTools:[],searchTools:[],ha:null,uploadDir:join(root,'uploads'),name:'Test',getEntitySummary:()=>'',getChatInstructions:()=>'',getDefaultModel:()=> 'local::test'});
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const create=(model='local::test')=>{const c=store.create(model);c.title='Private test';store.save(c);return c;};
 const send=(id:string,payload:any={content:'What city do I live in?'})=>app.inject({method:'POST',url:`/api/chat/conversations/${id}/messages`,payload});
 const seed=async()=>{const scope=await memory.beginTurn({conversationId:'seed',turnId:'seed-turn',sourceMessageId:'seed-message',text:'My city is Warsaw',privateMemoryAccess:()=>true});return (await memory.capture(scope,{text:scope.text,topic:'city',quote:scope.text,private:true})).memories[0];};
 return {app,memory,store,requests,create,send,seed,revoke(){trusted=false;for(const watcher of watchers)watcher();},speechTrust(value:boolean){speechPrivate=value;},speechCalls:()=>speechCalls};
}

test('private recall locks chat before model reuse, blocks cloud changes and speech, and protects branches',async t=>{
 const h=await harness(t);await h.seed();const c=h.create();const result=events((await h.send(c.id)).body);
 assert.ok(result.some(e=>e.type==='privacy'));assert.equal(h.store.get(c.id).privateMemoryUsed,true);
 assert.ok(JSON.stringify(h.requests[1]).includes('Warsaw'));
 const patch=await h.app.inject({method:'PATCH',url:`/api/chat/conversations/${c.id}`,payload:{model:'cloud::test',privateMemoryUsed:false}});assert.equal(patch.statusCode,403);
 const saved=h.store.get(c.id);const branch=await h.app.inject({method:'POST',url:`/api/chat/conversations/${c.id}/branch`,payload:{messageIndex:0,expectedMessageCount:saved.messages.length}});assert.equal(branch.statusCode,201);assert.equal(branch.json().privateMemoryUsed,true);
 const speech={method:'POST' as const,url:'/api/chat/speech',payload:{conversationId:c.id,text:'My city is Warsaw'}};
 assert.equal((await h.app.inject(speech)).statusCode,403);assert.equal(h.speechCalls(),0);
 assert.equal((await h.app.inject({...speech,payload:{text:'My city is Warsaw'}})).statusCode,400);
 h.speechTrust(true);assert.equal((await h.app.inject(speech)).statusCode,200);assert.equal(h.speechCalls(),1);
 h.revoke();const calls=h.requests.length;assert.equal((await h.send(c.id)).statusCode,403);assert.equal(h.requests.length,calls);
 assert.equal((await h.send(branch.json().id)).statusCode,403);
 const remote=h.create('cloud::test');await h.send(remote.id);assert.ok(!JSON.stringify(h.requests.slice(calls)).includes('Warsaw'));
});

test('privacy upgrade covers prior source/recall and branches even after memory deletion',async t=>{
 const h=await harness(t);const c=h.create('cloud::test');const scope=await h.memory.beginTurn({conversationId:c.id,turnId:'t',sourceMessageId:'m',text:'My city is Warsaw'});
 const fact=(await h.memory.capture(scope,{text:scope.text,topic:'city',quote:scope.text})).memories[0];await h.send(c.id);
 const saved=h.store.get(c.id);const branch=(await h.app.inject({method:'POST',url:`/api/chat/conversations/${c.id}/branch`,payload:{messageIndex:0,expectedMessageCount:saved.messages.length}})).json();
 const edited=await h.memory.edit(fact.id,fact.text!,fact.revision,true);await h.memory.delete(fact.id,edited.revision);
 const calls=h.requests.length;assert.equal((await h.send(c.id)).statusCode,403);assert.equal((await h.send(branch.id)).statusCode,403);assert.equal(h.requests.length,calls);
 assert.equal((await h.app.inject(`/api/chat/conversations/${c.id}`)).json().privateMemoryUsed,true);
});

test('revoking trust during private recall prevents another model request',async t=>{
 const h=await harness(t);await h.seed();const c=h.create();const stop=h.memory.subscribe(()=>h.revoke());
 const reply=events((await h.send(c.id)).body);stop();assert.equal(h.requests.length,1);assert.ok(reply.some(e=>e.type==='error'));assert.equal(h.store.get(c.id).privateMemoryUsed,true);
});

test('memory tools recheck access after asynchronous activity callbacks',async t=>{
 const h=await harness(t);let trusted=true;
 const scope=await h.memory.beginTurn({conversationId:'async',turnId:'t',sourceMessageId:'m',text:'My GPU is RTX 5070',privateMemoryAccess:()=>trusted});
 const tools=buildMemoryTools(h.memory,scope,async()=>{trusted=false;});
 await assert.rejects(tools.find(x=>x.name==='save_memory')!.handler({text:scope.text,topic:'gpu',quote:scope.text,private:true}),/expired/);
});


test('speech revocation follows the captured provider after the global selection changes',async t=>{
 let selected='a';const trust=new Map([['a',true],['b',true]]);let signal:AbortSignal|undefined;let started!:()=>void;
 const began=new Promise<void>(resolve=>{started=resolve;});
 const h=await harness(t,()=>{const id=selected;return {isPrivate:()=>trust.get(id)===true,synthesize:async(_text,abort)=>{
  signal=abort;started();return new Promise<Buffer>((_resolve,reject)=>abort.addEventListener('abort',()=>reject(Error('Speech cancelled')),{once:true}));
 }}});
 const c=h.create();c.privateMemoryUsed=true;h.store.save(c);
 const response=h.app.inject({method:'POST',url:'/api/chat/speech',payload:{conversationId:c.id,text:'Private response'}});
 const pending=response.then(r=>r);await began;selected='b';trust.set('a',false);h.revoke();
 assert.equal(signal?.aborted,true);assert.equal((await pending).statusCode,502);
});
