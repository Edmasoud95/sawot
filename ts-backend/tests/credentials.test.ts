import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { loadConfig } from '../src/config.js';
import { SettingsStore, registerSettingsRoutes } from '../src/settings.js';
import { ProviderRegistry } from '../src/providers.js';
function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'sawot-credentials-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, 'config.yaml');
  writeFileSync(config, 'home_assistant:\n  url: http://ha.invalid\n');
  return { config, path: join(dir, 'settings.json') };
}
test('startup without credentials permits settings setup', t => {
  assert.equal(loadConfig(fixture(t).config, {}).haToken, '');
});
test('migration preserves settings, persists keys once and honors removal', t => {
  const { config, path } = fixture(t);
  writeFileSync(path, JSON.stringify({ voice: 'af_bella', providers: [{ apiKey: 'provider-fixture' }] }));
  loadConfig(config, { HA_TOKEN: 'ha-fixture', BRAVE_API_KEY: 'brave-fixture', HF_TOKEN: 'hf-fixture' });
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.haToken, 'ha-fixture');
  assert.equal(saved.hfToken, 'hf-fixture');
  assert.equal(saved.braveApiKey, 'brave-fixture');
  assert.equal(saved.voice, 'af_bella');
  assert.equal(saved.providers[0].apiKey, 'provider-fixture');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(loadConfig(config, {}).haToken, 'ha-fixture');
  new SettingsStore(path).save({ haToken: '', braveApiKey: '' });
  const cfg = loadConfig(config, { HA_TOKEN: 'old', BRAVE_API_KEY: 'old' });
  assert.equal(cfg.haToken, '');
  assert.equal(cfg.braveApiKey, '');
});
test('corrupt settings are neither disclosed nor overwritten', t => {
  const { config, path } = fixture(t);
  writeFileSync(path, '{"haToken":"fixture-sensitive"');
  assert.throws(() => loadConfig(config, { HA_TOKEN: 'old' }), err => {
    assert.doesNotMatch(String(err), /fixture-sensitive/);
    return true;
  });
  assert.equal(readFileSync(path, 'utf8'), '{"haToken":"fixture-sensitive"');
});
test('credential API preserves omitted keys, validates writes and redacts responses', async t => {
  const { path } = fixture(t);
  const store = new SettingsStore(path);
  store.save({ haToken: 'ha-fixture', braveApiKey: 'brave-fixture', stt_model: 'speech-fixture' });
  const app = Fastify();
  t.after(() => app.close());
  const registry = new ProviderRegistry({ id: 'local', name: 'Local', baseUrl: 'http://unused.invalid', builtin: true });
  registerSettingsRoutes(app, {
    store, registry, state: { model: 'local::m', voice: 'af_heart', personality: 'plain', personalityPrompt: '', detailedDrawings: false, chatInstructions: '' },
    agent: {} as any, fallbackModel: 'local::m', summary: '', name: 'Test', setSystemPrompt() {},
    inference: { voices: async () => ({ engine: 'kokoro', voices: ['af_heart'], default: 'af_heart' }) } as any,
  });
  let res = await app.inject({ method: 'POST', url: '/api/settings', payload: { braveApiKey: 'new-fixture' } });
  assert.equal(res.statusCode, 200);
  assert.equal(store.load().braveApiKey, 'new-fixture');
  assert.equal(store.load().haToken, 'ha-fixture');
  assert.equal(store.load().stt_model, 'speech-fixture');
  for (const response of [res, await app.inject('/api/settings')]) {
    assert.deepEqual(response.json().credentials, { haToken: true, braveApiKey: true, hfToken: false });
    assert.doesNotMatch(response.body, /ha-fixture|new-fixture|brave-fixture/);
  }
  for (const bad of [null, 12, {}, 'x'.repeat(8193), 'key\nheader']) {
    res = await app.inject({ method: 'POST', url: '/api/settings', payload: { braveApiKey: bad, haToken: 'changed' } });
    assert.equal(res.statusCode, 400);
    assert.equal(store.load().haToken, 'ha-fixture');
  }
  res = await app.inject({ method: 'POST', url: '/api/settings', payload: { haToken: '' } });
  assert.equal(res.json().credentials.haToken, false);
  assert.equal(store.load().haToken, '');
  assert.equal(store.load().braveApiKey, 'new-fixture');
});

test('replacing or removing a Home Assistant token affects subsequent requests', async t => {
  const { HomeAssistant } = await import('../src/ha.js');
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: any) => {
    sent.push(options.headers.Authorization);
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  });
  const ha = new HomeAssistant('http://ha.invalid', 'before-fixture');
  await ha.getEntities();
  ha.setToken('after-fixture');
  await ha.getEntities();
  ha.setToken('');
  await assert.rejects(ha.getEntities(), /Settings/);
  assert.deepEqual(sent, ['Bearer before-fixture', 'Bearer after-fixture']);
});

test('Python model selection and TypeScript credential writes preserve each other', async t => {
  const { path } = fixture(t);
  const { spawn } = await import('node:child_process');
  const store = new SettingsStore(path);
  store.save({ haToken: 'old-fixture' });
  // Hold the shared lock as the Python writer reads its snapshot. Without a
  // TS lock its update returns before release and is then overwritten.
  const { fileURLToPath } = await import('node:url');
  const child = spawn('python3', ['-c', `
import json, pathlib, sys, time
sys.path.insert(0, sys.argv[2])
from server.settings import merge_settings
original_loads = json.loads
def slow_read(raw):
    result = original_loads(raw)
    print('locked', flush=True)
    time.sleep(.3)
    return result
json.loads = slow_read
merge_settings(pathlib.Path(sys.argv[1]), {'stt_model': 'new-model-fixture'})
`, path, fileURLToPath(new URL('../../', import.meta.url))]);
  t.after(() => child.kill());
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => resolve());
    child.once('error', reject);
  });
  store.save({ haToken: '' });
  await new Promise(resolve => child.once('close', resolve));
  assert.equal(store.load().haToken, '');
  assert.equal(store.load().stt_model, 'new-model-fixture');
});
