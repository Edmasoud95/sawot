import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/memory/store.js';

test('private facts are invisible to untrusted memory tools, including guessed IDs and duplicate saves', async t => {
 const dir=await mkdtemp(join(tmpdir(),'sawot-private-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=new MemoryStore(dir);let trusted=true;let locked=0;
 const scope=await store.beginTurn({conversationId:'local',turnId:'t1',sourceMessageId:'m1',text:'My GPU is an RTX 5070',privateMemoryAccess:()=>trusted,onPrivateMemory:()=>{locked++;}});
 const args={text:'User has RTX 5070',topic:'gpu',quote:scope.text,private:true};
 const saved=await store.capture(scope,args);const fact=saved.memories[0];
 assert.equal(fact.private,true);assert.ok(locked);assert.equal(await store.isConversationPrivate('local'),true);
 const remote=await store.beginTurn({conversationId:'remote',turnId:'t2',sourceMessageId:'m2',text:scope.text});
 assert.deepEqual((await store.search(remote,'')).memories,[]);
 assert.deepEqual((await store.search(remote,'gpu')).memories,[]);
 await assert.rejects(store.get(fact.id,remote),/no longer exists/);
 await assert.rejects(store.capture(remote,{...args,private:false,id:fact.id,revision:1}),/no longer exists/);
 const duplicate=await store.capture(remote,{...args,private:false});
 assert.notEqual(duplicate.memories[0].id,fact.id,'hidden duplicate does not disclose private ID');
 assert.equal(duplicate.memories[0].private,false);
 await assert.rejects(store.capture(remote,{...args,topic:'another',private:true}),/private provider/i);
 const trustedTurn=await store.beginTurn({conversationId:'local2',turnId:'t3',sourceMessageId:'m3',text:scope.text,privateMemoryAccess:()=>trusted});
 await assert.rejects(store.capture(trustedTurn,{...args,private:false,id:fact.id,revision:1}),/Only the user/);
 trusted=false;
 await assert.rejects(store.get(fact.id,scope),/no longer exists|expired/);
});

test('marking an existing fact private protects its source and prior recall conversations even after deletion', async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sawot-private-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new MemoryStore(dir);
 const scope=await store.beginTurn({conversationId:'source',turnId:'t1',sourceMessageId:'m1',text:'My city is Warsaw'});
 const saved=await store.capture(scope,{text:scope.text,quote:scope.text,topic:'city'});const fact=saved.memories[0];
 const recall=await store.beginTurn({conversationId:'recall',turnId:'t2',sourceMessageId:'m2',text:'Where do I live?'});await store.search(recall,'city');
 const edited=await store.edit(fact.id,fact.text!,fact.revision,true);
 assert.equal(await store.isConversationPrivate('source'),true);assert.equal(await store.isConversationPrivate('recall'),true);
 await store.delete(edited.id,edited.revision);
 const reload=new MemoryStore(dir);assert.equal(await reload.isConversationPrivate('source'),true);assert.equal(await reload.isConversationPrivate('recall'),true);
});
