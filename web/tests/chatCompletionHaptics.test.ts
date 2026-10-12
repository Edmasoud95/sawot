import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({ stdin: { contents: 'export { useChatStore } from "./chatStore"; export { useVoiceStore } from "./store"; export { haptics } from "./lib/haptics";', resolveDir: new URL('../src/', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' } });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
for (const scenario of ['success', 'duplicate', 'failed', 'stopped', 'hidden', 'voice', 'another chat', 'disabled', 'microphone', 'resumed', 'resumed duplicate', 'resumed failed', 'resumed stopped', 'old snapshot']) {
  test(`completion feedback: ${scenario}`, async () => {
    const pulses: number[] = [];
    Object.assign(globalThis, { window: { matchMedia: () => ({ matches: true }) }, location: { protocol: 'http:', host: 'localhost' }, localStorage: { getItem: () => scenario === 'disabled' ? 'off' : null }, document: { hidden: scenario === 'hidden' } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (ms: number) => { pulses.push(ms); return true; } } });
    const { useChatStore: chat, useVoiceStore: voice, haptics } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + '\n// ' + scenario).toString('base64')}`);
    const active = { id: 'a', title: 'Chat', messages: [], draftText: '', model: 'example' };
    chat.setState({ activeId: 'a', active, conversations: [], streaming: false });
    voice.setState({ mode: scenario === 'voice' ? 'orb' : 'chat' });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } });
    globalThis.fetch = async (url, init: any = {}) => {
      if (init.method === 'PATCH') return new Response('{}');
      if (String(url).endsWith('/a')) return Response.json({ ...active, responding: scenario !== 'old snapshot' });
      return new Response(response);
    };
    const emit = (event: any) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    const release = scenario === 'microphone' ? haptics.suppress() : () => {};
    if (scenario.startsWith('resumed') || scenario === 'old snapshot') await chat.getState().recoverConversation('a');
    else await chat.getState().startStream('Hello');
    await tick();
    if (scenario !== 'old snapshot') {
      if (scenario.startsWith('resumed')) emit({ type: 'snapshot', conversation: { ...active, responding: true } });
      if (scenario.endsWith('failed')) emit({ type: 'error', message: 'Failed' });
      if (scenario === 'stopped') chat.getState().abortStream();
      if (scenario === 'resumed stopped') chat.getState().detachStream();
      if (scenario === 'another chat') chat.setState({ activeId: 'b', active: { ...active, id: 'b' } });
      emit({ type: 'done', message: { role: 'assistant', content: 'Finished' } });
      await tick();
      if (scenario.endsWith('duplicate')) {
        await new Promise(resolve => setTimeout(resolve, 140));
        emit({ type: 'done', message: { role: 'assistant', content: 'Finished' } });
      }
      stream.close(); await tick(); await tick();
    }
    release();
    assert.deepEqual(pulses.filter(ms => ms > 0), ['success', 'duplicate', 'resumed', 'resumed duplicate'].includes(scenario) ? [12] : []);
    chat.getState().detachStream();
  });
}
