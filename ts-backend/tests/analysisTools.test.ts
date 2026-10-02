import test from 'node:test';import assert from 'node:assert/strict';
import {buildAnalysisTools} from '../src/analysis/tools.js';
import {RunnerClient} from '../src/analysis/runnerClient.js';
test('missing runner socket is unavailable without execution fallback',async()=>{
 const client=new RunnerClient('/tmp/nonexistent-sawot-test.sock');assert.equal((await client.ready()).ready,false);
 await assert.rejects(client.run('print(1)',[],AbortSignal.abort()));
});
test('tools close over scope and validate arguments before runner execution',async()=>{
 let called=0; const events:any[]=[];
 const runner={ready:async()=>({ready:true,runtime:'runsc',imageDigest:'sha256:a'}),run:async()=>{called++;return {status:'success',stdout:'5',stderr:'',exitCode:0,durationMs:1,truncated:false,outputs:[]};}};
 const files={read:()=>{throw Error('wrong file');},reserve:()=>({}),release:()=>{},add:()=>{throw Error('unused');}};
 const tools=buildAnalysisTools({scope:{conversationId:'a'.repeat(12),turnId:'b'.repeat(12),visibleTurnIds:[]},signal:new AbortController().signal,runner,files,emit:(e:any)=>events.push(e),webSearch:false} as any);
 assert.deepEqual(tools.map(t=>t.name),['run_python']);
 const py=tools[0];const bad=await py.handler({code:'x',file_ids:[],mount:'/'});assert.ok(bad.error);assert.equal(called,0);
 const result=await py.handler({code:'print(2+3)',file_ids:[]});assert.equal(result.stdout,'5');assert.equal(called,1);
 assert.equal(events.at(-1).phase,'complete');
});
test('tool errors preserve sanitized structured statuses',async()=>{
 const make=(ready:boolean,signal=new AbortController().signal)=>buildAnalysisTools({scope:{conversationId:'a'.repeat(12),turnId:'b'.repeat(12),visibleTurnIds:[]},signal,runner:{ready:async()=>({ready}),run:async()=>{throw Error('must not run');}},files:{},emit:()=>{},webSearch:false} as any)[0];
 assert.equal((await make(false).handler({code:'x',file_ids:[]})).status,'unavailable');
 assert.equal((await make(true,AbortSignal.abort()).handler({code:'x',file_ids:[]})).status,'cancelled');
 assert.equal((await make(true).handler({code:'x',file_ids:[],mount:'/'})).status,'policy_rejected');
});
test('owned deadlines and late runner unavailability retain status',async()=>{
 const base:any={scope:{conversationId:'a'.repeat(12),turnId:'b'.repeat(12),visibleTurnIds:[]},signal:new AbortController().signal,runner:{ready:async()=>({ready:true}),run:async()=>{throw Error('Python sandbox unavailable');}},files:{reserve:()=>({}),release:()=>{}},emit:()=>{},webSearch:true};
 const timeout=buildAnalysisTools({...base,download:async()=>{throw new DOMException('Download deadline exceeded','TimeoutError');}})[0];
 assert.equal((await timeout.handler({url:'https://example.org/file.csv'})).status,'timeout');
 const py=buildAnalysisTools(base).find(t=>t.name==='run_python')!;
 assert.equal((await py.handler({code:'print(1)',file_ids:[]})).status,'unavailable');
});
