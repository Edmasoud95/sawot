import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ChatStore } from '../src/chat.js';
import { AnalysisFileStore } from '../src/analysis/fileStore.js';
import { MemoryStore } from '../src/memory/store.js';
import { registerChatRoutes } from '../src/chatRoutes.js';
async function setup(t: any) {
 const root=mkdtempSync(join(tmpdir(),'sawot-branch-')), store=new ChatStore(join(root,'chats'));
 const files=new AnalysisFileStore(join(root,'analysis'),scope=>Boolean(store.get(scope.conversationId)));
 const memory=new MemoryStore(root);await memory.init();
 const uploadDir=join(root,'uploads');mkdirSync(uploadDir);const app=Fastify();
 registerChatRoutes(app,{store,memory,uploadDir,resolve:()=>{throw Error('Must not call model');},haTools:[],searchTools:[],ha:null,name:'Assistant',getEntitySummary:()=>'',getChatInstructions:()=>'',getDefaultModel:()=>'m',
 analysis:{files,runner:{ready:async()=>({ready:false,reason:'',runtime:'',imageDigest:''}),run:async()=>{throw Error('Must not run tools');}}}});
 t.after(async()=>{await app.close();files.close();rmSync(root,{recursive:true,force:true});});
 return {app,store,files,uploadDir,root,memory};
}
test('branch preserves prefix, settings and files independently of original deletion',async t=>{
 const {app,store,files,uploadDir}=await setup(t);const source=store.create('provider::model',true,false,true);
 source.title='Dinner';source.reasoningEffort='high';source.draftText='Do not copy this draft';source.responseError='Old error';source.uploadIds=['111111111111','222222222222'];
 source.messages=[{id:'aaaaaaaaaaaa',role:'user',content:'Analyze',attachments:[{id:'111111111111',name:'input.txt',kind:'text'}]},
 {id:'bbbbbbbbbbbb',role:'assistant',content:'Result'}, {id:'cccccccccccc',role:'user',content:'Later',attachments:[{id:'222222222222',name:'later.txt',kind:'text'}]}];store.save(source);
 writeFileSync(join(uploadDir,'111111111111.txt'),'input');writeFileSync(join(uploadDir,'222222222222.txt'),'later');
 const scope={conversationId:source.id,turnId:'bbbbbbbbbbbb',visibleTurnIds:['aaaaaaaaaaaa','bbbbbbbbbbbb']};
 const input=await files.add(files.reserve(scope,1,5),{name:'input.txt',mediaType:'text/plain',inputIds:[],uploadId:'111111111111'},[Buffer.from('input')]);
 const output=await files.add(files.reserve(scope,1,6),{name:'result.txt',mediaType:'text/plain',inputIds:[input.id]},[Buffer.from('result')]);
 source.messages[1].analysis=[{id:'event',turnId:scope.turnId,tool:'run_python',phase:'complete',inputs:[{id:input.id,name:input.name,path:`/inputs/${input.id}`}],result:{files:[output],status:'success'}}];
 source.messages[1].content=`[Result](/api/chat/conversations/${source.id}/analysis-files/${output.id})`;store.save(source);const before=store.get(source.id);
 const res=await app.inject({method:'POST',url:`/api/chat/conversations/${source.id}/branch`,payload:{messageIndex:1,expectedMessageCount:3}});
 assert.equal(res.statusCode,201,res.body);const branch=res.json();assert.notEqual(branch.id,source.id);assert.equal(branch.title,'Branch: Dinner');assert.equal(branch.messages.length,2);
 assert.equal(branch.model,source.model);assert.equal(branch.reasoningEffort,'high');assert.equal(branch.homeAssistant,true);assert.equal(branch.webSearch,false);assert.equal(branch.python,true);
 assert.equal(branch.draftText,'');assert.equal(branch.responseError,undefined);assert.deepEqual(branch.uploadIds,['111111111111']);assert.deepEqual(store.get(source.id),before);
 const copied=files.listVisible({...scope,conversationId:branch.id});assert.equal(copied.length,2);const ci=copied.find(f=>f.uploadId)!,co=copied.find(f=>!f.uploadId)!;
 assert.notEqual(co.id,output.id);assert.deepEqual(co.inputIds,[ci.id]);assert.equal(branch.messages[1].analysis[0].inputs[0].path,`/inputs/${ci.id}`);
 assert.ok(branch.messages[1].content.includes(`/api/chat/conversations/${branch.id}/analysis-files/${co.id}`));
 await app.inject({method:'DELETE',url:`/api/chat/conversations/${source.id}`});assert.ok(existsSync(join(uploadDir,'111111111111.txt')));assert.equal(existsSync(join(uploadDir,'222222222222.txt')),false);
 assert.equal(files.read({...scope,conversationId:branch.id},co.id).data.toString(),'result');assert.equal((await app.inject(`/api/chat/conversations/${branch.id}/analysis-files/${co.id}`)).statusCode,200);
 await app.inject({method:'DELETE',url:`/api/chat/conversations/${branch.id}`});assert.equal(existsSync(join(uploadDir,'111111111111.txt')),false);
});
test('branch rejects stale or invalid indices and supports user messages without generating',async t=>{
 const {app,store}=await setup(t);const source=store.create('m');source.messages=[{role:'user',content:'Hello'},{role:'assistant',content:'Hi'}];store.save(source);
 for(const messageIndex of [-1,2,0.5,'0',null])assert.equal((await app.inject({method:'POST',url:`/api/chat/conversations/${source.id}/branch`,payload:{messageIndex,expectedMessageCount:2}})).statusCode,400);
 assert.equal((await app.inject({method:'POST',url:`/api/chat/conversations/${source.id}/branch`,payload:{messageIndex:0,expectedMessageCount:1}})).statusCode,409);
 const res=await app.inject({method:'POST',url:`/api/chat/conversations/${source.id}/branch`,payload:{messageIndex:0,expectedMessageCount:2}});assert.equal(res.statusCode,201);assert.equal(res.json().messages.length,1);assert.equal(res.json().messages[0].content,source.messages[0].content);
});

test('copy failure rolls back the new chat and files without touching the source',async t=>{
 const {app,store,files,root}=await setup(t);const source=store.create('m');source.messages=[{id:'aaaaaaaaaaaa',role:'user',content:'Input'},{id:'bbbbbbbbbbbb',role:'assistant',content:'Output'}];store.save(source);
 const scope={conversationId:source.id,turnId:'bbbbbbbbbbbb',visibleTurnIds:['aaaaaaaaaaaa','bbbbbbbbbbbb']};
 const first=await files.add(files.reserve(scope,1,1),{name:'one',mediaType:'text/plain',inputIds:[]},[Buffer.from('1')]);
 const second=await files.add(files.reserve(scope,1,1),{name:'two',mediaType:'text/plain',inputIds:[]},[Buffer.from('2')]);
 unlinkSync(join(root,'analysis',second.id));
 const res=await app.inject({method:'POST',url:`/api/chat/conversations/${source.id}/branch`,payload:{messageIndex:1,expectedMessageCount:2}});
 assert.equal(res.statusCode,500);assert.deepEqual(store.list().map(c=>c.id),[source.id]);assert.equal(files.read(scope,first.id).data.toString(),'1');
 assert.equal(JSON.parse(readFileSync(join(root,'analysis','manifest.json'),'utf8')).length,2);
});

test('branches retain canonical memory activity across reopening and further branching without replaying it',async t=>{
 const {app,store,memory}=await setup(t);const source=store.create('m');source.messages=[{id:'aaaaaaaaaaaa',role:'user',content:'I own a bicycle'},{id:'bbbbbbbbbbbb',role:'assistant',content:'Remembered'}];store.save(source);
 const turn=await memory.beginTurn({conversationId:source.id,turnId:'bbbbbbbbbbbb',sourceMessageId:'aaaaaaaaaaaa',text:'I own a bicycle'});
 const event=await memory.capture(turn,{text:'User owns a bicycle',topic:'owned bicycle',category:'equipment',quote:'I own a bicycle'});
 const make=async(id:string)=>(await app.inject({method:'POST',url:`/api/chat/conversations/${id}/branch`,payload:{messageIndex:1,expectedMessageCount:2}})).json();
 const branch=await make(source.id);assert.equal(branch.messages[1].memory[0].id,event.id);assert.equal(branch.messages[1].memory[0].memories[0].text,undefined);
 assert.equal((await memory.eventsForConversation(branch.id)).length,0);
 const nested=await make(branch.id);assert.equal(nested.messages[1].memory[0].id,event.id);
 await app.inject({method:'DELETE',url:`/api/chat/conversations/${source.id}`});
 const reopened=(await app.inject(`/api/chat/conversations/${nested.id}`)).json();assert.equal(reopened.messages[1].memory[0].id,event.id);
 await memory.clear();const cleared=(await app.inject(`/api/chat/conversations/${nested.id}`)).json();assert.equal(cleared.messages[1].memory[0].memories[0].text,undefined);
});
