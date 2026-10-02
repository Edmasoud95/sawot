import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnalysisFileStore } from '../src/analysis/fileStore.js';
const scope={conversationId:'aaaaaaaaaaaa',turnId:'bbbbbbbbbbbb',visibleTurnIds:['bbbbbbbbbbbb']};
test('private files enforce conversation and visible turn ownership',async()=>{
 const root=mkdtempSync(join(tmpdir(),'analysis-')); const store=new AnalysisFileStore(root,()=>true);
 try {
  const r=store.reserve(scope,1,100); const f=await store.add(r,{name:'../data.csv',mediaType:'text/csv',inputIds:[]},[Buffer.from('a\n5')]);
  assert.equal(store.listVisible(scope).length,1);
  assert.equal(store.read(scope,f.id).data.toString(),'a\n5');
  assert.throws(()=>store.read({...scope,conversationId:'cccccccccccc'},f.id));
  assert.throws(()=>store.read({...scope,turnId:'dddddddddddd',visibleTurnIds:[]},f.id));
  assert.throws(()=>store.read(scope,'../manifest'));
  store.prune(scope.conversationId,[]); assert.equal(store.listVisible(scope).length,0);
 } finally {store.close(); rmSync(root,{recursive:true,force:true});}
});
test('reservations and deletion prevent quota races and late writes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'analysis-')); const store=new AnalysisFileStore(root,()=>true);
 try {
  const a=store.reserve(scope,100,200*1024*1024);
  assert.throws(()=>store.reserve(scope,1,1)); store.release(a);
  const b=store.reserve(scope,1,10); store.deleteConversation(scope.conversationId);
  await assert.rejects(store.add(b,{name:'a',mediaType:'text/plain',inputIds:[]},[Buffer.from('x')]));
  assert.equal(store.listVisible(scope).length,0);
 } finally {store.close(); rmSync(root,{recursive:true,force:true});}
});
test('second writer rejected and interrupted reservation recovered on reopen',()=>{
 const root=mkdtempSync(join(tmpdir(),'analysis-')); const first=new AnalysisFileStore(root,()=>true);
 try {assert.throws(()=>new AnalysisFileStore(root,()=>true)); first.reserve(scope,1,20); first.close(); const second=new AnalysisFileStore(root,()=>true); second.reserve(scope,100,200*1024*1024); second.close();}
 finally{first.close();rmSync(root,{recursive:true,force:true});}
});
