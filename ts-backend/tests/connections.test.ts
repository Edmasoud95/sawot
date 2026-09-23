import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { loadConfig } from '../src/config.js';
import { HomeAssistant } from '../src/ha.js';
import { SettingsStore, registerSettingsRoutes } from '../src/settings.js';
import { ProviderRegistry } from '../src/providers.js';

function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'sawot-connections-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { config: join(dir, 'config.yaml'), store: new SettingsStore(join(dir, 'settings.json')) };
}

test('new installs start without HA; legacy address migrates once and saved address wins', t => {
  const { config, store } = fixture(t);
  assert.equal(loadConfig(config, {}).haUrl, '');
  writeFileSync(config, 'home_assistant:\n  url: http://yaml.invalid:8123/\n');
  assert.equal(loadConfig(config, { HA_URL: 'http://env.invalid:8123/' }).haUrl, 'http://env.invalid:8123');
  assert.equal(store.load().haUrl, 'http://env.invalid:8123');
  store.save({ haUrl: 'https://saved.invalid/ha' });
  assert.equal(loadConfig(config, { HA_URL: 'http://old.invalid' }).haUrl, 'https://saved.invalid/ha');
  store.save({ haUrl: '' });
  assert.equal(loadConfig(config, { HA_URL: 'http://old.invalid' }).haUrl, '');
});

test('HA address and token save together, apply live, and reject unsafe addresses without mutation', async t => {
  const { store } = fixture(t);
  store.save({ haUrl: 'http://old.invalid', haToken: 'old-fixture' });
  const ha = new HomeAssistant('http://old.invalid', 'old-fixture');
  const requests: any[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: any) => {
    requests.push({ url, token: options.headers.Authorization });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });
  const app = Fastify();
  t.after(() => app.close());
  registerSettingsRoutes(app, {
    store, registry: new ProviderRegistry({ id: 'local', name: 'Local', baseUrl: 'http://unused.invalid', builtin: true }),
    state: { model: 'local::m', voice: 'af_heart', personality: 'plain', personalityPrompt: '', detailedDrawings: false, chatInstructions: '' },
    agent: {} as any, fallbackModel: 'local::m', summary: '', name: 'Test', setSystemPrompt() {},
    inference: { voices: async () => ({ engine: 'kokoro', voices: ['af_heart'], default: 'af_heart' }) } as any,
    onCredentialsChanged: (connection: any) => ha.setConnection(connection.haUrl, connection.haToken),
  });
  let res = await app.inject({ method: 'POST', url: '/api/settings', payload: { haUrl: ' https://new.invalid:8123/ha/ ', haToken: 'new-fixture' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().haUrl, 'https://new.invalid:8123/ha');
  assert.doesNotMatch(res.body, /new-fixture|old-fixture/);
  await ha.getEntities();
  assert.deepEqual(requests.pop(), { url: 'https://new.invalid:8123/ha/api/states', token: 'Bearer new-fixture' });
  for (const bad of [null, 1, 'ftp://host', 'https://user:secret@host', 'https://host/?token=secret', 'https://host/#secret', 'https://ho\nst', 'http:host', 'https://host/white space']) {
    res = await app.inject({ method: 'POST', url: '/api/settings', payload: { haUrl: bad, haToken: 'should-not-save' } });
    assert.equal(res.statusCode, 400, String(bad));
    assert.equal(store.load().haToken, 'new-fixture');
    assert.equal(store.load().haUrl, 'https://new.invalid:8123/ha');
    assert.doesNotMatch(res.body, /secret|should-not-save/);
  }
  res = await app.inject({ method: 'POST', url: '/api/settings', payload: { haUrl: 'http://another.invalid/' } });
  assert.equal(res.statusCode, 200);
  assert.equal(store.load().haToken, 'new-fixture');
  await ha.getEntities();
  assert.equal(requests.pop().url, 'http://another.invalid/api/states');
  res = await app.inject({ method: 'POST', url: '/api/settings', payload: { haUrl: '' } });
  assert.equal(res.statusCode, 200);
  await assert.rejects(ha.getEntities(), /Settings/);
});
