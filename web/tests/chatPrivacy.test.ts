import assert from 'node:assert/strict';
import test from 'node:test';
import { privateChatProviders, mergeChatPrivacy } from '../src/lib/chatPrivacy.ts';

test('private chats require explicit provider trust including built-in and legacy providers', () => {
  const providers = [
    { id: 'builtin', name: 'Local', models: ['a'], builtin: true },
    { id: 'remote', name: 'Remote', models: ['b'], privateMemoryAccess: false },
    { id: 'trusted', name: 'Trusted', models: ['c'], privateMemoryAccess: true },
  ];
  assert.deepEqual(privateChatProviders(providers, true).map(p => p.id), ['trusted']);
  assert.equal(privateChatProviders(providers, false), providers);
  assert.deepEqual(privateChatProviders(providers.slice(0, 2), true), []);
});

test('late recovery snapshots cannot remove conversation privacy', () => {
  assert.equal(mergeChatPrivacy(true, undefined), true);
  assert.equal(mergeChatPrivacy(true, false), true);
  assert.equal(mergeChatPrivacy(false, true), true);
  assert.equal(mergeChatPrivacy(undefined, undefined), false);
});
