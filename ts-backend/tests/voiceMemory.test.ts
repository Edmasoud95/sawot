import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory/store.js';
import { beginVoiceMemory } from '../src/memory/voice.js';
async function setup(t:any) { const dir=await mkdtemp(join(tmpdir(),'voice-memory-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new MemoryStore(dir);await store.init();return store; }
test('voice memory saves only the current spoken assertion and emits redacted activity',async t=>{
 const store=await setup(t);const events:any[]=[];
 const turn=await beginVoiceMemory(store,{id:'voice:test'},'Remember that my GPU is RTX 5070',()=>true,undefined,e=>{events.push(e);});
 const save=turn.tools.find(t=>t.name==='save_memory')!;
 await save.handler({text:'My GPU is RTX 5070',topic:'gpu',quote:'my GPU is RTX 5070',captureMode:'explicit'});
 assert.equal(events[0].kind,'saved');assert.equal(events[0].memories[0].text,undefined);
 await assert.rejects(save.handler({text:'I live in Warsaw',topic:'location',quote:'I live in Warsaw'}),/quote/i);
 turn.close();
});
test('private voice recall requires trust for every recipient and locks the session after disclosure',async t=>{
 const store=await setup(t);const seed=await store.beginTurn({conversationId:'seed',turnId:'seed',sourceMessageId:'seed',text:'My GPU is RTX 5070',privateMemoryAccess:()=>true});
 await store.capture(seed,{text:'My GPU is RTX 5070',topic:'gpu',quote:seed.text,private:true});
 const session={id:'live:test',privateMemoryUsed:false};let trusted=false;
 let turn=await beginVoiceMemory(store,session,'What is my GPU?',()=>trusted);
 assert.deepEqual((await turn.tools.find(t=>t.name==='search_memories')!.handler({query:'gpu'}) as any).memories,[]);turn.close();
 trusted=true;turn=await beginVoiceMemory(store,session,'What is my GPU?',()=>trusted);
 assert.equal((await turn.tools.find(t=>t.name==='search_memories')!.handler({query:'gpu'}) as any).memories.length,1);
 assert.equal(session.privateMemoryUsed,true);trusted=false;
 assert.throws(()=>turn.guard(),/private/i);turn.close();
 await assert.rejects(beginVoiceMemory(store,session,'Hello',()=>false),/private/i);
});
test('cancelled voice work cannot save memory',async t=>{
 const store=await setup(t);const controller=new AbortController();
 const turn=await beginVoiceMemory(store,{id:'voice:test'},'My GPU is RTX 5070',()=>true,controller.signal);
 controller.abort();await assert.rejects(turn.tools.find(t=>t.name==='save_memory')!.handler({text:'My GPU is RTX 5070',topic:'gpu',quote:'My GPU is RTX 5070'}));turn.close();
});

test('standard voice uses the transcribed user text for capture and emits activity before speech',async t=>{
 const {Agent}=await import('../src/agent.js');const {runVoiceTurn}=await import('../src/pipeline.js');
 const store=await setup(t);let round=0;const prompts:any[]=[];const events:any[]=[];
 const text='Remember that my GPU is RTX 5070';
 const client:any={chat:{completions:{create:async(body:any)=>{prompts.push(body);return {choices:[{message:round++===0?{content:null,tool_calls:[{id:'save',type:'function',function:{name:'save_memory',arguments:JSON.stringify({text:'My GPU is RTX 5070',topic:'gpu',quote:'my GPU is RTX 5070',captureMode:'explicit'})}}]}:{content:'I remembered your GPU.'}}]};}}}};
 const agent=new Agent(client,'test',[],'Be brief.',(text,signal,event)=>beginVoiceMemory(store,{id:'voice:standard'},text,()=>true,signal,event));
 const inference:any={transcribe:async()=>text,voices:async()=>({engine:'kokoro'}),synthesize:async()=>Buffer.from('audio')};
 await runVoiceTurn(inference,agent,Buffer.from('input'),[],async(kind,data)=>{events.push({kind,data});},'test');
 assert.ok(prompts[0].tools.some((t:any)=>t.function.name==='search_memories'));
 assert.ok(events.find(e=>e.kind==='memory'&&e.data.kind==='saved'));
 assert.ok(events.findIndex(e=>e.kind==='memory')<events.findIndex(e=>e.kind==='wav'));
 const debug=events.filter(e=>e.kind==='debug'&&['tool_call','tool_result'].includes(e.data.event));
 assert.doesNotMatch(JSON.stringify(debug),/RTX 5070/);
});

test('live delegation captures only the latest actual transcript and returns clickable activity once',async t=>{
 const {Agent}=await import('../src/agent.js');const {LiveToolSession}=await import('../src/liveTools.js');
 const store=await setup(t);const session={id:'live:test'};let round=0;
 const client:any={chat:{completions:{create:async()=>({choices:[{message:round++===0?{content:null,tool_calls:[{id:'save',type:'function',function:{name:'save_memory',arguments:JSON.stringify({text:'My GPU is RTX 5070',topic:'gpu',quote:'my GPU is RTX 5070',captureMode:'explicit'})}}]}:{content:'Memory saved.'}}]})}}};
 const live=new LiveToolSession(()=>new Agent(client,'test',[],'',(text,signal,event)=>beginVoiceMemory(store,session,text,()=>true,signal,event)));
 const turns:any=[{role:'user',text:'Remember that my GPU is RTX 5070',start:0,end:1}];
 const result=await live.run('one',turns);
 assert.equal(result.memory?.[0].kind,'saved');assert.equal(result.memory?.[0].memories[0].text,undefined);
 assert.equal(await live.run('one',turns),result);assert.equal(round,2);live.close();
});

test('disabling memory aborts active work and omits tools on the next turn', async t => {
  const store = await setup(t);
  const turn = await beginVoiceMemory(store, { id: 'voice:disabled' }, 'Hello', () => true);
  await store.setEnabled(false);
  assert.equal(turn.signal.aborted, true);
  turn.close();
  const next = await beginVoiceMemory(store, { id: 'voice:disabled' }, 'Hello', () => true);
  assert.deepEqual(next.tools, []);
  assert.equal(next.prompt, '');
  next.close();
});

test('old voice tool results lose deleted facts and original save arguments', async t => {
  const store = await setup(t);
  const session = { id: 'voice:history' };
  let turn = await beginVoiceMemory(store, session, 'My GPU is RTX 5070', () => true);
  const result: any = await turn.tools.find(t => t.name === 'save_memory')!.handler({ text: 'My GPU is RTX 5070', topic: 'gpu', quote: 'My GPU is RTX 5070' });
  turn.close();
  const fact = result.memories[0];
  await store.delete(fact.id, fact.revision);
  turn = await beginVoiceMemory(store, session, 'What is my GPU?', () => true);
  const messages: any[] = [
    { role: 'assistant', tool_calls: [{ id: 'save', function: { name: 'save_memory', arguments: JSON.stringify({ text: 'My GPU is RTX 5070' }) } }] },
    { role: 'tool', tool_call_id: 'save', content: JSON.stringify(result) },
  ];
  await turn.prepare(messages);
  assert.doesNotMatch(JSON.stringify(messages), /RTX 5070/);
  assert.deepEqual(JSON.parse(messages[1].content).memories, []);
  turn.close();
});

test('provider trust guard rejects revoked access and changed provider identity', async () => {
  const { ProviderRegistry } = await import('../src/providers.js');
  const { privateProviderGuard } = await import('../src/memory/voice.js');
  const registry = new ProviderRegistry({ id: 'local', name: 'Local', baseUrl: 'http://localhost:1234/v1', privateMemoryAccess: true });
  const allowed = privateProviderGuard(registry, 'local');
  assert.equal(allowed(), true);
  registry.setPrivateMemoryAccess('local', false);
  assert.equal(allowed(), false);
  registry.setPrivateMemoryAccess('local', true);
  registry.get('local')!.baseUrl = 'https://different.example/v1';
  assert.equal(allowed(), false);
});
