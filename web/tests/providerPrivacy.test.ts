import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({ entryPoints: [new URL('../src/components/chat/useModels.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' } });
Object.assign(globalThis, { location: { protocol: 'http:', host: 'localhost' } });
const providers = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const list = (trusted: boolean) => [{ id: 'local', name: 'Local', models: ['model'], privateMemoryAccess: trusted, state: 'ready' }];

test('policy changes survive stale initial loads and later refreshes can apply new policy', async () => {
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise(resolve => { release = resolve; });
  const first = providers.refreshProviderPrivacy();
  providers.updateProviderPrivacy(list(false));
  release(new Response(JSON.stringify({ providers: list(true) })));
  assert.equal((await first).providers[0].privateMemoryAccess, false);
  const stale = providers.beginProviderRefresh();
  providers.updateProviderPrivacy(list(true));
  assert.equal(providers.updateProviderPrivacy(list(false), stale), false);
  const current = providers.beginProviderRefresh();
  assert.equal(providers.updateProviderPrivacy(list(false), current), true);
  assert.deepEqual(await providers.fetchModels(), ['local::model']);
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).endsWith('/api/settings') ? { providers: list(true) } : { models: ['model'] }));
  assert.equal((await providers.refreshProviderPrivacy()).providers[0].privateMemoryAccess, true);
});
