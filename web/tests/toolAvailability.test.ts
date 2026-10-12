import assert from 'node:assert/strict';
import test from 'node:test';
import { pollToolAvailability } from '../src/lib/toolAvailability';

test('availability updates from unavailable to ready without reopening', async () => {
  const events: boolean[] = [];
  let ready = false;
  const stop = pollToolAvailability({
    url: '/api/chat/tools', intervalMs: 1,
    fetcher: async () => ({ ok: true, json: async () => ({ homeAssistant: true, python: ready }) }) as Response,
    update: value => { events.push(value.python); ready = true; },
    error: () => assert.fail('unexpected error'),
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  stop();
  assert.equal(events[0], false);
  assert.ok(events.includes(true));
});

test('closing the menu aborts the pending request and suppresses late updates', async () => {
  let finish!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  let updates = 0;
  const stop = pollToolAvailability({
    url: '/api/chat/tools', intervalMs: 1,
    fetcher: async (_url, options) => { signal = options?.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); },
    update: () => { updates++; }, error: () => { updates++; },
  });
  stop();
  assert.equal(signal?.aborted, true);
  finish({ ok: true, json: async () => ({ homeAssistant: true, python: true }) } as Response);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(updates, 0);
});

test('failed availability check recovers on the next poll', async () => {
  let attempts = 0;
  let errors = 0;
  let updates = 0;
  const stop = pollToolAvailability({
    url: '/api/chat/tools', intervalMs: 1,
    fetcher: async () => {
      if (++attempts === 1) throw new Error('offline');
      return { ok: true, json: async () => ({ homeAssistant: true, python: true }) } as Response;
    },
    update: () => { updates++; }, error: () => { errors++; },
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  stop();
  assert.equal(errors, 1);
  assert.ok(updates > 0);
});
