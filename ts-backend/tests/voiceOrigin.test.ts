import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket, { WebSocketServer } from "ws";
import { isAllowedVoiceOrigin } from "../src/voiceOrigin.js";

test("only explicitly allowed origins complete a real WebSocket handshake", async () => {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true,
    verifyClient: ({ origin }) => isAllowedVoiceOrigin(origin, ["https://voice.example"]),
  });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => ws.close()));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  try {
    for (const [origin, expected] of [
      ["https://voice.example", 101],
      ["https://untrusted.example", 401],
      [undefined, 401], ["null", 401],
      ["http://voice.example", 401], ["https://voice.example:444", 401],
      ["https://voice.example.attacker.example", 401],
      ["https://voice.example/", 401],
      ["https://voice.example, https://untrusted.example", 401],
    ] as const) {
      const status = await new Promise<number>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
          headers: { Host: "untrusted.example", ...(origin === undefined ? {} : { Origin: origin }) },
          handshakeTimeout: 2000,
        });
        ws.on("open", () => { resolve(101); ws.close(); });
        ws.on("unexpected-response", (_req, res) => { resolve(res.statusCode!); res.resume(); ws.terminate(); });
        ws.on("error", reject);
      });
      assert.equal(status, expected, `Origin: ${origin}`);
    }
    assert.equal(isAllowedVoiceOrigin("https://voice.example", []), false);
  } finally {
    for (const client of wss.clients) client.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
