import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from '../src/chat.js';

test('deletion cleans sent and unsent files including sidecars, preserving shared files', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-delete-'));
  try {
    const store = new ChatStore(join(root, 'chats'));
    const uploads = join(root, 'uploads'); mkdirSync(uploads);
    const chat = store.create('m');
    chat.messages = [{ role: 'user', attachments: [{ id: 'aaaaaaaaaaaa' }, { id: 'bbbbbbbbbbbb' }, { id: '../outside' }] }];
    chat.uploadIds = ['cccccccccccc']; store.save(chat);
    const shared = store.create('m'); shared.uploadIds = ['bbbbbbbbbbbb']; store.save(shared);
    for (const name of ['aaaaaaaaaaaa.pdf', 'aaaaaaaaaaaa.pdftxt', 'bbbbbbbbbbbb.png', 'cccccccccccc.txt', 'dddddddddddd.jpg']) writeFileSync(join(uploads, name), 'data');
    store.delete(chat.id, uploads);
    assert.equal(store.get(chat.id), null);
    for (const name of ['aaaaaaaaaaaa.pdf', 'aaaaaaaaaaaa.pdftxt', 'cccccccccccc.txt']) assert.equal(existsSync(join(uploads, name)), false);
    for (const name of ['bbbbbbbbbbbb.png', 'dddddddddddd.jpg']) assert.equal(existsSync(join(uploads, name)), true);
    store.delete(chat.id, uploads);
    store.delete(shared.id, uploads);
    assert.equal(existsSync(join(uploads, 'bbbbbbbbbbbb.png')), false);
    assert.throws(() => store.delete('../outside', uploads));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cleanup failure leaves conversation available for retry', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-delete-'));
  try {
    const store = new ChatStore(join(root, 'chats'));
    const uploads = join(root, 'uploads'); mkdirSync(uploads);
    const chat = store.create('m'); chat.uploadIds = ['aaaaaaaaaaaa']; store.save(chat);
    mkdirSync(join(uploads, 'aaaaaaaaaaaa.txt'));
    assert.throws(() => store.delete(chat.id, uploads));
    assert.ok(store.get(chat.id));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { registerChatRoutes } from '../src/chatRoutes.js';

test('chat uploads are owned before sending and deleted through the API', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-delete-api-'));
  const app = Fastify();
  try {
    const store = new ChatStore(join(root, 'chats'));
    const uploads = join(root, 'uploads'); mkdirSync(uploads);
    await app.register(multipart);
    registerChatRoutes(app, { store, uploadDir: uploads, resolve: () => { throw Error('no model'); }, haTools: [], searchTools: [], ha: null, name: 'Test', getEntitySummary: () => '', getChatInstructions: () => '', getDefaultModel: () => 'm' });
    const chat = store.create('m');
    const upload = () => app.inject({ method: 'POST', url: `/api/chat/upload?conversationId=${chat.id}`, headers: { 'content-type': 'multipart/form-data; boundary=test' }, payload: '--test\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--test--\r\n' });
    const response = await upload(); assert.equal(response.statusCode, 200);
    const id = response.json().id;
    assert.ok(store.get(chat.id).uploadIds.includes(id));
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/chat/conversations/${chat.id}` })).statusCode, 204);
    assert.equal(existsSync(join(uploads, id + '.txt')), false);
    assert.equal((await upload()).statusCode, 404);
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/chat/conversations/invalid' })).statusCode, 400);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
