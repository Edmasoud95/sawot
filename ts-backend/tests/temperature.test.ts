import assert from 'node:assert/strict';
import test from 'node:test';
import { Agent } from '../src/agent.js';
import { runVoiceTurn } from '../src/pipeline.js';

async function run(state: string, selection = 'sensor.room', unit = '°C') {
  let round = 0;
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: round++ === 0
    ? { content: null, tool_calls: [{ id: '1', function: { name: 'get_entities', arguments: '{"domain":"sensor"}' } }] }
    : { content: `<expression:neutral><temperature:${selection}>The room is ${state} degrees.` } }] }) } } };
  const agent = new Agent(client as never, 'test', [{ name: 'get_entities', description: '', parameters: {}, handler: async () => [
    { entity_id: 'sensor.other', state: '18', attributes: { unit_of_measurement: '°C' } },
    { entity_id: 'sensor.room', state, attributes: { unit_of_measurement: unit } },
  ] }], 'Assistant');
  const events: any[] = [];
  const spoken: string[] = [];
  await runVoiceTurn({ transcribe: async () => 'Room temperature?', synthesize: async (text: string) => { spoken.push(text); return Buffer.from('wav'); } } as never,
    agent, Buffer.from('audio'), [], (type, data) => { events.push({ type, ...data }); }, 'voice');
  assert.ok(spoken.every(text => !text.includes('<temperature:')));
  return events;
}

test('selected sensor supplies the actual value and unit at playback', async () => {
  const events = await run('21.5');
  const reading = events.find(e => e.type === 'reading');
  assert.equal(reading?.value, 21.5);
  assert.equal(reading?.unit, '°C');
  assert.equal(reading?.entity_id, 'sensor.room');
  assert.ok(events.indexOf(reading) > events.findIndex(e => e.type === 'assistant_text'));
  assert.ok(events.indexOf(reading) < events.findIndex(e => e.type === 'wav'));
});
test('zero and negative Fahrenheit temperatures are retained', async () => {
  assert.equal((await run('0')).find(e => e.type === 'reading')?.value, 0);
  assert.equal((await run('-4.5', 'sensor.room', '°F')).find(e => e.type === 'reading')?.unit, '°F');
});
test('unknown, non-temperature and invented readings are suppressed', async () => {
  for (const [state, selection, unit] of [['unavailable','sensor.room','°C'], ['', 'sensor.room','°C'], ['22','sensor.invented','°C'], ['45','sensor.room','%']]) {
    assert.equal((await run(state, selection, unit)).some(e => e.type === 'reading'), false);
  }
});

test('Home Assistant preserves measurement attributes needed to validate readings', async () => {
  const { HomeAssistant } = await import('../src/ha.js');
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([{ entity_id: 'sensor.room', state: '0', attributes: {
    friendly_name: 'Room', unit_of_measurement: '°C', device_class: 'temperature', unrelated: 'unused',
  } }]))) as typeof fetch;
  try {
    const entities = await new HomeAssistant('http://ha.test', 'test').getEntities('sensor');
    assert.equal(entities[0].attributes?.unit_of_measurement, '°C');
    assert.equal(entities[0].state, '0');
    assert.equal(entities[0].attributes?.unrelated, undefined);
  } finally { globalThis.fetch = original; }
});

test('climate uses the measured temperature, never the setpoint', async () => {
  const { temperatureReading } = await import('../src/temperature.js');
  const entity = { entity_id: 'climate.room', state: 'heat', attributes: { unit_of_measurement: '°C', current_temperature: 19, temperature: 24 } };
  assert.equal(temperatureReading(entity)?.value, 19);
  assert.equal(temperatureReading({ ...entity, attributes: { ...entity.attributes, current_temperature: null } }), null);
});
