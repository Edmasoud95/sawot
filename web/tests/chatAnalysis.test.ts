import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeAnalysisEvent,mergeAnalysisEvents,analysisFileUrl} from '../src/lib/chatAnalysis';
const event={id:'a'.repeat(32),turnId:'b'.repeat(12),tool:'run_python',phase:'start',code:'print(5)'};
test('analysis events converge and late starts cannot overwrite completion',()=>{
 const start=normalizeAnalysisEvent(event)!;assert.ok(start);
 const done=normalizeAnalysisEvent({...event,phase:'complete',result:{status:'success',stdout:'5',stderr:'',files:[]}})!;
 assert.equal(mergeAnalysisEvents(mergeAnalysisEvents([start],done),start)[0].phase,'complete');
 assert.equal(normalizeAnalysisEvent({...event,id:'../escape'}),null);
 assert.equal(normalizeAnalysisEvent({...event,tool:'eval'}),null);
});
test('file links only use valid server IDs and hostile text stays text',()=>{
 assert.equal(analysisFileUrl('../x','a'.repeat(32)),null);
 assert.ok(analysisFileUrl('b'.repeat(12),'a'.repeat(32))?.endsWith('a'.repeat(32)));
 const e=normalizeAnalysisEvent({...event,code:'<script>alert(1)</script>'})!;
 assert.equal(e.code,'<script>alert(1)</script>');
});
