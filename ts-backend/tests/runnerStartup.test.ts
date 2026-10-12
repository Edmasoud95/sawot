import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureRunner, runnerReady, waitForApp } from '../../scripts/start-runner.mjs';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture(overrides = {}) {
  const calls: string[] = [];
  return {
    calls,
    options: {
      socket: '/run/sawot-runner/runner.sock',
      ready: async () => { calls.push('ready'); return false; },
      active: () => { calls.push('active'); return false; },
      start: () => { calls.push('start'); return true; },
      waitReady: async () => { calls.push('wait'); return true; },
      log: (message: string) => { calls.push(message); },
      ...overrides,
    },
  };
}

test('unconfigured runner does not probe or start a service', async () => {
  const f = fixture({ socket: '' });
  await ensureRunner(f.options);
  assert.deepEqual(f.calls, []);
});
test('ready runner avoids sudo and service changes', async () => {
  const f = fixture({ ready: async () => true });
  await ensureRunner(f.options);
  assert.deepEqual(f.calls, []);
});
test('configured stopped runner is started and checked by the background helper', async () => {
  const f = fixture();
  await ensureRunner(f.options);
  assert.deepEqual(f.calls.filter(c => ['ready', 'active', 'start', 'wait'].includes(c)), ['ready', 'active', 'start', 'wait']);
});

test('sandbox startup waits until the application is reachable', async () => {
  let probes = 0;
  let pauses = 0;
  assert.equal(await waitForApp({ pid: 1, alive: () => true,
    probe: async () => ++probes === 3, pause: async () => { pauses++; },
  }), true);
  assert.equal(probes, 3);
  assert.equal(pauses, 2);
});

test('exited backend prevents sandbox startup', async () => {
  assert.equal(await waitForApp({ pid: 1, alive: () => false,
    probe: async () => assert.fail('must not probe after exit'),
  }), false);
});

test('application readiness timeout does not start the sandbox', async () => {
  let probes = 0;
  assert.equal(await waitForApp({ pid: 1, alive: () => true, attempts: 2,
    probe: async () => { probes++; return false; }, pause: async () => {},
  }), false);
  assert.equal(probes, 2);
});
test('active unready runner is left intact instead of interrupting jobs', async () => {
  const f = fixture({ active: () => true });
  await ensureRunner(f.options);
  assert.equal(f.calls.includes('start'), false);
  assert.match(f.calls.at(-1)!, /unavailable/);
});
test('failed startup does not block SAWOT or claim readiness', async () => {
  const f = fixture({ start: () => false });
  await ensureRunner(f.options);
  assert.equal(f.calls.includes('wait'), false);
  assert.match(f.calls.at(-1)!, /unavailable/);
});
test('custom sockets do not start a different local service', async () => {
  const f = fixture({ socket: '/tmp/custom.sock' });
  await ensureRunner(f.options);
  assert.equal(f.calls.includes('start'), false);
  assert.match(f.calls.at(-1)!, /unavailable/);
});
test('service start without readiness leaves code execution unavailable', async () => {
  const f = fixture({ waitReady: async () => false });
  await ensureRunner(f.options);
  assert.match(f.calls.at(-1)!, /unavailable/);
});

test('readiness requires gVisor, stable paths and a pinned image digest', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runner-startup-'));
  const socket = join(directory, 'runner.sock');
  let payload: any = { ready: true, runtime: 'runsc', inputPaths: 'stable-v1', imageDigest: 'sha256:' + 'a'.repeat(64) };
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/v1/ready');
    response.end(JSON.stringify(payload));
  });
  try {
    await new Promise<void>(resolve => server.listen(socket, resolve));
    assert.equal(await runnerReady(socket), true);
    for (const invalid of [{ ready: false }, { runtime: 'runc' }, { inputPaths: 'old' }, { imageDigest: 'sawot-python:latest' }]) {
      const saved = payload;
      payload = { ...payload, ...invalid };
      assert.equal(await runnerReady(socket), false);
      payload = saved;
    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(await runnerReady(socket), false);
});
