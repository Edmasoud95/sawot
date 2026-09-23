import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent } from '../src/agent.js';
import { runVoiceTurn } from '../src/pipeline.js';
import { loadVoiceImages } from '../src/voiceImages.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

Agent.replyLogPath = '';
const image = { type: 'image_url' as const, image_url: { url: 'data:image/png;base64,aGVsbG8=' } };

for (const withAudio of [true, false]) {
  test(`pictures reach the model and follow-up history ${withAudio ? 'with speech' : 'without speech'}`, async () => {
    const requests: any[] = [];
    const agent = new Agent({ chat: { completions: { create: async (request: any) => {
      requests.push(structuredClone(request));
      return { choices: [{ message: { content: 'A picture.', role: 'assistant' } }] };
    } } } } as any, 'vision', [], 'test');
    const inference = {
      transcribe: async () => { assert.ok(withAudio, 'picture-only must skip STT'); return 'What is this?'; },
      voices: async () => ({ engine: 'kokoro' }),
      synthesize: async () => Buffer.from('wav'),
    };
    const history: any[] = [], events: any[] = [];
    await runVoiceTurn(inference as any, agent, withAudio ? Buffer.from('audio') : null,
      history, (kind, payload) => { events.push({ kind, payload }); }, 'voice', undefined, undefined, undefined, [image]);
    const content = requests[0]?.messages[1]?.content;
    assert.ok(Array.isArray(content), 'model must receive multimodal content');
    assert.deepEqual(content[1], image);
    assert.match(content[0].text, withAudio ? /What is this/ : /picture/i);
    assert.ok(events.some(e => e.kind === 'wav'));
    await agent.run(history, 'Tell me more');
    assert.deepEqual(requests[1].messages[1].content[1], image);
  });
}

test('voice images resolve local uploads and reject unsafe or missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-images-'));
  try {
    await writeFile(join(dir, '123456abcdef.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
    const images = await loadVoiceImages(['123456abcdef'], dir);
    assert.match(images[0].image_url.url, /^data:image\/png;base64,iVBOR/);
    for (const invalid of [['../../secret'], ['https://example.com'], '123456abcdef', Array(5).fill('123456abcdef'), ['abcdef123456']]) {
      await assert.rejects(loadVoiceImages(invalid, dir));
    }
    await writeFile(join(dir, 'abcdef123456.png'), 'not a picture');
    await assert.rejects(loadVoiceImages(['abcdef123456'], dir));
    await writeFile(join(dir, 'abcdef123456.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(loadVoiceImages(['abcdef123456'], dir));
    assert.deepEqual(await loadVoiceImages(undefined, dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
