import assert from 'node:assert/strict';
import { test } from 'node:test';
// Bundle Vite's env constants as Vite does; the WebSocket boundary is fake.
import { build } from '../node_modules/esbuild/lib/main.js';
const { outputFiles } = await build({ entryPoints: ['../web/src/lib/socket.ts'], bundle: true, write: false, format: 'esm', define: { 'import.meta.env.VITE_API_BASE': '""', 'import.meta.env.VITE_WS_BASE': '"ws://test"' } });
const { VoiceSocket } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles![0].text).toString('base64'));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onmessage: any; onopen: any; onclose: any;
  sent: any[] = [];
  constructor(_url: string) { Socket.instances.push(this); }
  send(data: any) { this.sent.push(data); }
  close() { this.readyState = 3; this.onclose?.(); }
  event(data: any) { this.onmessage({ data: JSON.stringify(data) }); }
}
(globalThis as any).WebSocket = Socket;
test('cancelled response frames cannot reach UI or leak into a new turn', () => {
  const events: any[] = [], audio: any[] = [];
  const client = new VoiceSocket({ onOpen() {}, onClose() {}, onEvent: (m: any) => events.push(m), onAudio: (a: any) => audio.push(a) });
  const wire = Socket.instances.at(-1)!;
  client.sendAudio(new ArrayBuffer(1));
  assert.equal(typeof client.cancelTurn, 'function');
  const first = JSON.parse(wire.sent[0]).turnId;
  wire.event({ type: 'audio', turnId: first });
  client.cancelTurn();
  client.sendAudio(new ArrayBuffer(1));
  const second = JSON.parse(wire.sent.at(-2)).turnId;
  wire.onmessage({ data: new ArrayBuffer(1) });
  wire.event({ type: 'assistant_text', turnId: first, text: 'stale' });
  wire.event({ type: 'assistant_text', turnId: second, text: 'new' });
  wire.event({ type: 'audio', turnId: second });
  wire.onmessage({ data: new ArrayBuffer(2) });
  wire.onmessage({ data: new ArrayBuffer(3) });
  assert.deepEqual(events, [{ type: 'assistant_text', turnId: second, text: 'new' }]);
  assert.equal(audio.length, 1);
  assert.equal(audio[0].byteLength, 2);
  client.close();
  wire.event({ type: 'assistant_text', turnId: second, text: 'closed' });
  assert.equal(events.length, 1);
});
