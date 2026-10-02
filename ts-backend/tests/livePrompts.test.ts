import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLivePrompt, DEFAULT_LIVE_PROMPT } from '../src/livePrompts.js';
import { buildSystemPrompt, normalizePersonality } from '../src/agent.js';
import { liveBackendPrompt } from '../src/liveTools.js';

test('performance personalities apply to standard and live voice', () => {
  for (const [personality, expected] of [['angry', /theatrically angry/i], ['flirty', /playfully flirty/i], ['crying', /tearful.*whiny/i]] as const) {
    assert.equal(normalizePersonality(personality), personality);
    assert.match(buildSystemPrompt('', personality), expected);
    const live = buildLivePrompt({ personality, tools: true, search: true });
    assert.match(live, expected);
    assert.match(live, /theatre rehearsal/i);
    assert.match(live, /laugh when asked/i);
    assert.match(live, /Search the web/);
    assert.ok(!live.includes('switch to Standard'));
  }
});

test('editable Live templates expand current settings once and can be reset', () => {
  assert.equal(buildLivePrompt({ name: 'Rita', personality: 'custom', personalityPrompt: 'Say {name} literally', template: '{name}: {personality}' }), 'Rita: Say {name} literally');
  assert.match(buildLivePrompt({ template: '', tools: false }), /No tool backend/);
  assert.match(DEFAULT_LIVE_PROMPT, /\{capabilities\}/);
  assert.equal(liveBackendPrompt('Device rules', '{device_context}\nReturn facts.'), 'Device rules\nReturn facts.');
});

test('the girlfriend preset replaces assistant identity and allows spontaneous interruptions', () => {
  const live = buildLivePrompt({ name: 'Rita', personality: 'crying', tools: true });
  assert.match(live, /You are Rita,.*angry girlfriend/i);
  assert.match(live, /interrupt.*talk over/i);
  assert.doesNotMatch(live, /expressive conversational voice assistant|without talking over|Stop speaking and listen when interrupted/);
  assert.match(live, /explicitly.*stop.*pause/i);
  const standard = buildSystemPrompt('', 'crying', 'Rita');
  assert.match(standard, /You are Rita,.*angry girlfriend/i);
  assert.doesNotMatch(standard, /friendly voice assistant|one or two sentences/);
});
