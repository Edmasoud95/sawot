import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionController, shouldReveal, subscribeMotionEnvironment } from '../src/lib/motion.ts';
function fixture() {
  const element = { x: 0, ownerDocument: { defaultView: { getComputedStyle: () => ({ getPropertyValue: (name: string) => name.endsWith('ease') ? '0.22,1,0.36,1' : '180' }) } } } as any;
  const jobs: any[] = [];
  const driver = {
    set(target: any, vars: any) { Object.assign(target, vars); },
    to(target: any, vars: any) { const job = { killed: false, finish() { if (!this.killed) Object.assign(target, vars); }, kill() { this.killed = true; } }; jobs.push(job); return job; },
  };
  return { element, jobs, controller: createMotionController(element, driver) };
}
test('retargeting never resets the rendered position or lets stale work win', () => {
  const { element, jobs, controller } = fixture();
  controller.to({ x: 100 }, 'reveal', false); element.x = 37;
  controller.to({ x: 0 }, 'reveal', false); jobs[0].finish(); assert.equal(element.x, 37);
  jobs[1].finish(); assert.equal(element.x, 0);
});
test('finish applies only the latest endpoint and cancels pending movement', () => {
  const { element, jobs, controller } = fixture();
  controller.to({ x: 100 }, 'reveal', false); controller.to({ x: 5 }, 'reveal', false);
  controller.finish(); jobs.forEach(job => job.finish()); assert.equal(element.x, 5);
});
test('instant movement has no tween; disposed controllers cannot write', () => {
  const { element, jobs, controller } = fixture();
  controller.to({ x: 8 }, 'reveal', true); assert.equal(element.x, 8); assert.equal(jobs.length, 0);
  controller.to({ x: 50 }, 'reveal', false); controller.dispose(); jobs[0].finish();
  controller.to({ x: 90 }, 'reveal', true); controller.finish(); assert.equal(element.x, 8);
});
test('arrivals do not replay on unchanged content or clearing', () => {
  assert.equal(shouldReveal('turn-1', 'turn-1'), false); assert.equal(shouldReveal('turn-1', null), false);
  assert.equal(shouldReveal(null, 'turn-2'), true); assert.equal(shouldReveal('turn-1', 'turn-2'), true);
});
test('environment subscription observes both sources and cleans up', () => {
  const query = new EventTarget(); const page = new EventTarget(); let changes = 0;
  const unsubscribe = subscribeMotionEnvironment(query as any, page as any, () => changes++);
  query.dispatchEvent(new Event('change')); page.dispatchEvent(new Event('visibilitychange')); assert.equal(changes, 2);
  unsubscribe(); query.dispatchEvent(new Event('change')); page.dispatchEvent(new Event('visibilitychange')); assert.equal(changes, 2);
});

test('environment settling finishes finite arrivals without advancing continuous indicators', async () => {
  const { settleFiniteAnimations } = await import('../src/lib/motion.ts');
  const states = [0, 0];
  const animations = [180, Infinity].map((endTime, i) => ({ effect: { getComputedTiming: () => ({ endTime }) }, finish() { states[i] = endTime; } }));
  settleFiniteAnimations(animations as any);
  assert.deepEqual(states, [180, 0]);
});
