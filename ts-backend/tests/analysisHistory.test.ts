import test from 'node:test';import assert from 'node:assert/strict';
import {toOpenAiMessages} from '../src/chat.js';
import {addFileInventory,fileReference} from '../src/analysis/context.js';
const file={id:'a'.repeat(32),name:'data.csv',size:12};
test('stable references and inventory preserve the latest user question',()=>{
 assert.equal(fileReference(file).path,`/inputs/${file.id}`);
 const history=[{role:'assistant',content:'Previous answer'},{role:'user',content:'What did it show?'}];
 addFileInventory(history,[file]);
 assert.equal(history.at(-1)?.content,'What did it show?');
 assert.equal(history.at(-2)?.role,'assistant');
 assert.match(history.at(-2)!.content,/must select.*file_ids/);
});
test('follow-up history retains bounded actual results and errors',()=>{
 const history=toOpenAiMessages([{role:'assistant',content:'',analysis:[{id:'b'.repeat(32),turnId:'c'.repeat(12),tool:'run_python',phase:'complete',code:'print(5)',inputs:[fileReference(file)],result:{status:'success',stdout:'5',stderr:'',files:[]}}]},{role:'user',content:'Explain that'}],'/tmp');
 assert.match(history[0].content,/Recorded analysis/);assert.match(history[0].content,/"stdout":"5"/);
 assert.match(history[0].content,/\/inputs\/aaaa/);assert.equal(history.at(-1).content,'Explain that');
 const large=toOpenAiMessages([{role:'assistant',content:'Answer',analysis:[{tool:'run_python',phase:'error',result:{status:'python_error',stderr:'x'.repeat(1000000)}}]}],'/tmp');
 assert.ok(large[0].content.length<20000);assert.match(large[0].content,/truncated/);
});
