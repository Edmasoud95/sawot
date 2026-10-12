import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpring } from '../src/lib/spring.ts';
import { createHaptics } from '../src/lib/haptics.ts';

test('spring reverses continuously, settles, and stops requesting frames', () => {
  let now = 0; let next: FrameRequestCallback | undefined; let value = 1;
  const spring = createSpring(1, x => { value = x; }, { request: cb => { next = cb; return 1; }, cancel: () => { next = undefined; } });
  const step = () => { const cb = next; next = undefined; now += 16; cb?.(now); };
  spring.to(.92); step(); step(); const before = value;
  spring.to(1); assert.equal(value, before, 'retarget does not jump');
  for (let i = 0; i < 180 && next; i++) step();
  assert.equal(value, 1); assert.equal(next, undefined);
  spring.to(.92); spring.to(1, true); assert.equal(value, 1); assert.equal(next, undefined);
  spring.dispose(); spring.to(.5); assert.equal(value, 1); assert.equal(next, undefined);
});

test('haptics are optional, throttled, silent when hidden or recording, and release independently', () => {
  let enabled = true, visible = true, time = 0; const calls: number[] = [];
  const haptics = createHaptics({ enabled: () => enabled, visible: () => visible, now: () => time, vibrate: ms => { calls.push(ms); return true; } });
  assert.equal(haptics.pulse('selection'), true); assert.equal(haptics.pulse('confirmation'), false);
  time += 200; const releaseA = haptics.suppress(); const releaseB = haptics.suppress();
  releaseA(); releaseA(); assert.equal(haptics.pulse(), false);
  releaseB(); assert.equal(haptics.pulse('confirmation'), true);
  time += 200; enabled = false; assert.equal(haptics.pulse(), false);
  enabled = true; visible = false; assert.equal(haptics.pulse(), false);
  assert.deepEqual(calls.filter(n => n > 0), [8, 12]);
});

test('haptic hardware failures never escape into an interaction', () => {
  const haptics = createHaptics({ enabled: () => true, visible: () => true, now: () => 0, vibrate: () => { throw new Error('unavailable'); } });
  assert.equal(haptics.pulse(), false); assert.doesNotThrow(() => haptics.suppress()());
});
