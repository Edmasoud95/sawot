import { setTimeout as delay } from 'node:timers/promises';
import type { HomeAssistant, Card } from './ha.js';

type Command = { entity_id: string; service: string; domain: string };

function matchesRequestedPower(card: Card, command: Command): boolean {
  if (command.service === 'turn_off') return card.state === 'off';
  if (command.service === 'turn_on') {
    if (command.domain === 'media_player') return ['on', 'idle', 'playing', 'paused', 'buffering'].includes(card.state);
    return card.state === 'on';
  }
  return true;
}

// Service acceptance may precede the integration's state update. Re-read the
// target only; never replay a service call to obtain confirmation.
export async function readConfirmedCard(ha: HomeAssistant, command: Command, signal: AbortSignal): Promise<Card> {
  while (true) {
    signal.throwIfAborted();
    const [card] = await ha.getCards([command.entity_id], signal);
    signal.throwIfAborted();
    if (card && matchesRequestedPower(card, command)) return card;
    await delay(150, undefined, { signal });
  }
}

export function createControlHandler(ha: HomeAssistant, controls: Record<string, string[]>) {
  const queues = new Map<string, Promise<void>>();
  return async (socket: { send: (data: string) => void }, raw: string): Promise<void> => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { msg = null; }
    const requestId = typeof msg?.requestId === 'string' && msg.requestId.length <= 100 ? msg.requestId : undefined;
    const reply = (ok: boolean, card?: any, message?: string) => {
      try {
        socket.send(JSON.stringify(requestId
          ? { type: 'control_result', requestId, entity_id: msg?.entity_id, ok, ...(card ? { card } : {}), ...(message ? { message } : {}) }
          : ok ? { type: 'entities', entities: [card] } : { type: 'error', source: 'control', message }));
      } catch { /* The initiating socket may have disconnected. */ }
    };
    if (!msg || msg.type !== 'control') { reply(false, undefined, 'Malformed control message.'); return; }
    const { domain, service, entity_id } = msg;
    if (typeof entity_id !== 'string' || !entity_id.startsWith(`${domain}.`) || (!Array.isArray(controls[domain]) || !controls[domain].includes(service))) {
      reply(false, undefined, 'Control not allowed.'); return;
    }
    const signal = AbortSignal.timeout(8000);
    const previous = queues.get(entity_id) ?? Promise.resolve();
    const job = previous.then(async () => {
      try {
        signal.throwIfAborted();
        await ha.callService(domain, service, entity_id, msg.data, signal);
        const card = await readConfirmedCard(ha, msg, signal);
        reply(true, card);
      } catch { reply(false, undefined, 'Could not confirm the change. Check the device and try again.'); }
    });
    queues.set(entity_id, job);
    await job;
    if (queues.get(entity_id) === job) queues.delete(entity_id);
  };
}
