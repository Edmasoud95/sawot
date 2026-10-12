import assert from 'node:assert/strict';
import test from 'node:test';
import { runChat } from '../src/chat.js';
test('up to 30 cards arrive after a tool, before the final model answer', async () => {
  let round=0;
  const ids=Array.from({length:40},(_,i)=>`light.test_${i}`);
  const client={chat:{completions:{create:async()=> (async function*(){
    yield {choices:[{delta:round++===0?{tool_calls:[{index:0,id:'one',function:{name:'get_entities',arguments:'{}'}}]}:{content:'Done'}}]};
  })()}}};
  const tools=[{name:'get_entities',description:'',parameters:{},handler:async()=>ids,touchedIds:()=>ids}];
  const events=[];
  for await(const event of runChat(client,'test',tools,'',[],async ids=>ids.map(entity_id=>({entity_id}))))events.push(event);
  const cards=events.findIndex(e=>e[0]==='entities');
  assert.ok(cards>=0 && cards<events.findIndex(e=>e[0]==='content'));
  assert.equal(events[cards][1].length,30);
});
