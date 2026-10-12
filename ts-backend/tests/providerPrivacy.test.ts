import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { ProviderRegistry } from '../src/providers.js';
import { SettingsStore, registerSettingsRoutes } from '../src/settings.js';
const local = { id: 'local', name: 'Local', baseUrl: 'http://localhost:1234/v1' };
const remote = { id: 'remote', name: 'Remote', baseUrl: 'https://example.com/v1', apiKey: 'test-secret' };
test('provider memory trust defaults off and fails closed for removed providers', () => {
  const registry = new ProviderRegistry(local, [remote]);
  assert.equal(registry.isPrivate('model'), false);
  assert.equal(registry.listing()[0].privateMemoryAccess, false);
  registry.setPrivateMemoryAccess('local', true);
  assert.equal(registry.isPrivate('model'), true);
  assert.equal(registry.isPrivate('local::model'), true);
  assert.equal(registry.isPrivate('remote::model'), false);
  assert.equal(registry.isPrivate('missing::model'), false);
  registry.setPrivateMemoryAccess('remote', true);
  assert.equal(registry.isPrivate('remote::model'), true);
  assert.equal(registry.customSpecs()[0].privateMemoryAccess, true);
  const events: string[] = [];
  const unsubscribe = registry.subscribePrivacy(id => events.push(id));
  registry.setPrivateMemoryAccess('remote', false);
  assert.equal(registry.isPrivate('remote::model'), false);
  registry.setPrivateMemoryAccess('remote', true);
  registry.remove('remote');
  assert.equal(registry.isPrivate('remote::model'), false);
  assert.deepEqual(events, ['remote', 'remote']);
  unsubscribe();
  registry.setPrivateMemoryAccess('local', false);
  assert.equal(events.length, 2);
  assert.throws(() => registry.setPrivateMemoryAccess('missing', true), /unknown provider/);
  assert.equal(new ProviderRegistry({ ...local, privateMemoryAccess: 'true' as any }).isPrivate('model'), false);
});
test('privacy settings validate and persist trust without exposing credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'provider-privacy-'));
  const store = new SettingsStore(join(dir, 'settings.json'));
  const registry = new ProviderRegistry(local, [remote]);
  const app = Fastify();
  registerSettingsRoutes(app, {
    store, registry, agent: {} as any, state: { model: 'local::model', voice: 'af_heart' } as any,
    fallbackModel: 'local::model', summary: '', name: 'SAWOT', setSystemPrompt() {},
    inference: { voices: async () => ({ engine: 'kokoro', voices: [], default: null }) } as any,
  });
  try {
    for (const payload of [{}, { privateMemoryAccess: 'true' }, { privateMemoryAccess: 1 }, { privateMemoryAccess: true, extra: 1 }, []]) {
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/providers/local/privacy', payload })).statusCode, 400);
    }
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/providers/missing/privacy', payload: { privateMemoryAccess: true } })).statusCode, 404);
    for (const id of ['local', 'remote']) {
      const response = await app.inject({ method: 'PATCH', url: `/api/providers/${id}/privacy`, payload: { privateMemoryAccess: true } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().providers.find((p: any) => p.id === id).privateMemoryAccess, true);
      assert.equal(response.body.includes('test-secret'), false);
    }
    const saved = store.load();
    const restored = new ProviderRegistry({ ...local, privateMemoryAccess: saved.localPrivateMemoryAccess }, saved.providers);
    assert.equal(restored.isPrivate('model'), true);
    assert.equal(restored.isPrivate('remote::model'), true);
    await app.inject({ method: 'PATCH', url: '/api/providers/local/privacy', payload: { privateMemoryAccess: false } });
    assert.equal(store.load().localPrivateMemoryAccess, false);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a failing privacy listener cannot prevent other cancellations or provider removal', () => {
  const registry = new ProviderRegistry(local, [{ ...remote, privateMemoryAccess: true }]);
  const notified: string[] = [];
  registry.subscribePrivacy(() => { throw new Error('subscriber failed'); });
  registry.subscribePrivacy(id => notified.push(id));
  assert.doesNotThrow(() => registry.setPrivateMemoryAccess('remote', false));
  assert.equal(registry.isPrivate('remote::model'), false);
  assert.doesNotThrow(() => registry.remove('remote'));
  assert.equal(registry.get('remote'), undefined);
  assert.deepEqual(notified, ['remote', 'remote']);
});
