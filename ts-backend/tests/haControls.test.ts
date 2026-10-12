import assert from 'node:assert/strict';
import test from 'node:test';
import { HomeAssistant } from '../src/ha.js';
import { createControlHandler, readConfirmedCard } from '../src/controls.js';
test('single-device refresh fetches only that entity', async () => {
  const original = globalThis.fetch; const paths: string[] = [];
  globalThis.fetch = async url => { paths.push(String(url)); return new Response(JSON.stringify({ entity_id:'light.test', state:'on', last_updated:'2026-10-09T10:00:00.000Z', attributes:{ friendly_name:'Test', brightness:128 } })); };
  try {
    const cards = await new HomeAssistant('http://ha.test', 'test-token').getCards(['light.test']);
    assert.deepEqual(paths, ['http://ha.test/api/states/light.test']); assert.equal(cards[0].attrs.brightness, 128);
    assert.equal(cards[0].updatedAt, Date.parse('2026-10-09T10:00:00.000Z'));
  } finally { globalThis.fetch = original; }
});
test('controls correlate success and failure without leaking internal errors', async () => {
  const messages: any[] = [];
  const ha: any = { callService: async()=>{}, getCards:async()=>[{entity_id:'light.test',state:'on',attrs:{}}] };
  const handler = createControlHandler(ha, {light:['turn_on']});
  const socket = { send: (text:string)=>messages.push(JSON.parse(text)) };
  await handler(socket, JSON.stringify({type:'control',requestId:'one',entity_id:'light.test',domain:'light',service:'turn_on'}));
  assert.equal(messages[0].type,'control_result'); assert.equal(messages[0].requestId,'one'); assert.equal(messages[0].ok,true);
  ha.callService = async()=>{throw Error('private host details');};
  await handler(socket, JSON.stringify({type:'control',requestId:'two',entity_id:'light.test',domain:'light',service:'turn_on'}));
  assert.equal(messages[1].ok,false); assert.equal(messages[1].requestId,'two'); assert.doesNotMatch(JSON.stringify(messages),/private host/);
  await handler(socket, JSON.stringify({type:'control',requestId:'three',entity_id:'light.test',domain:'light',service:'unsafe'}));
  assert.equal(messages[2].ok,false);
});

test('commands for the same device serialize even across sockets', async () => {
  let release!: () => void;
  const calls: string[] = [];
  const ha: any = {
    callService: async (_domain:string, service:string) => {
      calls.push(service);
      if (service === 'turn_on') await new Promise<void>(resolve => { release = resolve; });
    },
    getCards: async () => [{ entity_id:'light.test',state:calls.at(-1)==='turn_off'?'off':'on',attrs:{} }],
  };
  const handler=createControlHandler(ha,{light:['turn_on','turn_off']});
  const first=handler({send(){}},JSON.stringify({type:'control',requestId:'one',entity_id:'light.test',domain:'light',service:'turn_on'}));
  const second=handler({send(){}},JSON.stringify({type:'control',requestId:'two',entity_id:'light.test',domain:'light',service:'turn_off'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['turn_on']);
  release(); await Promise.all([first,second]); assert.deepEqual(calls,['turn_on','turn_off']);
});

test('turning off waits through stale HA reads and never acknowledges the old on state', async () => {
  let reads=0, commands=0;
  const messages:any[]=[];
  const ha:any={callService:async()=>{commands++;},getCards:async()=>[{entity_id:'light.test',state:++reads<3?'on':'off',attrs:{}}]};
  await createControlHandler(ha,{light:['turn_off']})({send:raw=>messages.push(JSON.parse(raw))},JSON.stringify({type:'control',requestId:'delayed-off',entity_id:'light.test',domain:'light',service:'turn_off'}));
  assert.equal(commands,1);
  assert.equal(reads,3);
  assert.equal(messages.length,1);
  assert.equal(messages[0].card.state,'off');
});


test('confirmation remains bounded when HA never reports the requested state', async () => {
  const ha:any={getCards:async()=>[{entity_id:'light.test',state:'on',attrs:{}}]};
  await assert.rejects(readConfirmedCard(ha,{entity_id:'light.test',domain:'light',service:'turn_off'},AbortSignal.timeout(20)),/abort|timeout/i);
});
