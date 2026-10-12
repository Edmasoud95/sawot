import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceControls, applyControl } from '../src/lib/deviceControls.ts';
const lamp = { entity_id: 'light.test', domain: 'light', name: 'Test', state: 'off', attrs: { brightness: 128 } };
const command = (service: string, data = {}) => ({ type: 'control', entity_id: lamp.entity_id, domain: 'light', service, data });
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const snapshots: any[] = [], sent: any[] = [], replies: any[] = [];
  const controls = new DeviceControls((id, state) => snapshots.push(state));
  const transport = (message: any) => { sent.push(message); return new Promise<any>((resolve, reject) => replies.push({ resolve, reject })); };
  return { controls, snapshots, sent, replies, transport };
}
test('optimistic state is immediate; rapid changes serialize without older replies rewinding it', async () => {
  const { controls, snapshots, sent, replies, transport } = setup();
  controls.send(lamp, command('turn_on'), transport);
  controls.send(lamp, command('turn_off'), transport);
  assert.equal(snapshots.at(-1).card.state, 'off');
  assert.equal(snapshots.at(-1).pending, true); assert.equal(sent.length, 1);
  replies[0].resolve({ ...lamp, state: 'on' }); await tick();
  assert.equal(sent.length, 2); assert.equal(snapshots.at(-1).card.state, 'off');
  replies[1].resolve(lamp); await tick(); assert.equal(snapshots.at(-1).pending, false);
});
test('failure rolls back to confirmed state with a visible error', async () => {
  const { controls, snapshots, replies, transport } = setup();
  controls.send(lamp, command('turn_on'), transport);
  replies[0].reject(new Error('Device unavailable')); await tick();
  assert.equal(snapshots.at(-1).card.state, 'off');
  assert.equal(snapshots.at(-1).error, 'Device unavailable'); assert.equal(snapshots.at(-1).pending, false);
});
test('older failure preserves newer intent; unsent slider changes coalesce', async () => {
  const { controls, snapshots, sent, replies, transport } = setup();
  controls.send(lamp, command('turn_on', { brightness_pct: 20 }), transport);
  controls.send(lamp, command('turn_on', { brightness_pct: 40 }), transport);
  controls.send(lamp, command('turn_on', { brightness_pct: 80 }), transport);
  replies[0].reject(new Error('Failed')); await tick();
  assert.equal(sent.length, 2); assert.equal(sent[1].data.brightness_pct, 80);
  assert.equal(snapshots.at(-1).card.attrs.brightness, 204);
  replies[1].resolve({ ...lamp, state: 'on', attrs: { brightness: 204 } }); await tick();
  assert.equal(snapshots.at(-1).error, '');
});
test('brightness, color, warmth and thermostat targets update without mutating source data', () => {
  const updated = applyControl(lamp, command('turn_on', { brightness_pct: 50, rgb_color: [1,2,3], color_temp_kelvin: 3000 }));
  assert.equal(updated.attrs.brightness, 128); assert.deepEqual(updated.attrs.rgb_color, [1,2,3]);
  assert.equal(updated.attrs.color_temp_kelvin, 3000); assert.equal(lamp.state, 'off');
  assert.equal(applyControl(lamp, command('set_temperature', { temperature: 22 })).attrs.temperature, 22);
});

test('incoming snapshots cannot replace pending state and different devices can proceed independently', async () => {
  const { controls, snapshots, sent, replies, transport } = setup();
  controls.send(lamp, command('turn_on'), transport);
  controls.refresh({ ...lamp, state:'off' });
  assert.equal(snapshots.at(-1).card.state,'on');
  const other={...lamp,entity_id:'light.other'};
  controls.send(other,{...command('turn_on'),entity_id:other.entity_id},transport);
  assert.equal(sent.length,2);
  replies[1].resolve({...other,state:'on'}); replies[0].resolve({...lamp,state:'on'}); await tick();
  controls.refresh({...lamp,state:'off'});
  assert.equal(snapshots.at(-1).card.state,'off');
});

test('an older HA snapshot cannot turn a confirmed-off device back on', async () => {
  const {controls,snapshots,replies,transport}=setup();
  controls.send({...lamp,state:'on',updatedAt:100},command('turn_off'),transport);
  replies[0].resolve({...lamp,state:'off',updatedAt:200});await tick();
  controls.refresh({...lamp,state:'on',updatedAt:100});
  assert.equal(snapshots.at(-1).card.state,'off');
  controls.refresh({...lamp,state:'on',updatedAt:300});
  assert.equal(snapshots.at(-1).card.state,'on');
});
