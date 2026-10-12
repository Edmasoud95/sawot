export interface DeviceCard {
  updatedAt?: number;
  entity_id: string; domain: string; name: string; state: string; area?: string; attrs: Record<string, any>;
}
export interface DeviceCommand {
  type: string; entity_id: string; domain: string; service: string; data?: Record<string, any>;
}
export interface ControlState { card: DeviceCard; pending: boolean; error: string }
type Transport = (command: DeviceCommand) => Promise<DeviceCard>;
type Entry = { confirmed: DeviceCard; queue: Array<{ command: DeviceCommand; transport: Transport }>; error: string };

export function applyControl(card: DeviceCard, command: DeviceCommand): DeviceCard {
  const attrs = { ...card.attrs };
  const data = command.data ?? {};
  if (typeof data.brightness_pct === 'number') attrs.brightness = Math.round(data.brightness_pct * 255 / 100);
  for (const key of ['rgb_color', 'color_temp_kelvin', 'temperature']) if (key in data) attrs[key] = data[key];
  const state = command.service === 'turn_on' ? 'on' : command.service === 'turn_off' ? 'off' : card.state;
  return { ...card, state, attrs };
}

// A single in-flight command per device. New intent stays visible while older
// acknowledgements arrive; only unsent adjacent commands may be coalesced.
export class DeviceControls {
  private entries = new Map<string, Entry>();
  constructor(private publish: (id: string, state: ControlState) => void) {}

  send(card: DeviceCard, command: DeviceCommand, transport: Transport) {
    let entry = this.entries.get(card.entity_id);
    if (!entry) {
      entry = { confirmed: card, queue: [], error: '' };
      this.entries.set(card.entity_id, entry);
    }
    entry.error = '';
    const tail = entry.queue[entry.queue.length - 1];
    if (entry.queue.length > 1 && tail?.command.service === command.service) {
      tail.command = { ...command, data: { ...tail.command.data, ...command.data } };
    } else entry.queue.push({ command, transport });
    this.emit(card.entity_id, entry);
    if (entry.queue.length === 1) void this.run(card.entity_id, entry);
  }

  // Fresh server snapshots may update idle devices, but cannot overwrite
  // optimistic state while that device has an outstanding command.
  refresh(card: DeviceCard) {
    const entry = this.entries.get(card.entity_id);
    if (entry && !entry.queue.length) {
      if (entry.confirmed.updatedAt !== undefined && (card.updatedAt === undefined || card.updatedAt < entry.confirmed.updatedAt)) return;
      entry.confirmed = card;
      this.emit(card.entity_id, entry);
    }
  }

  private emit(id: string, entry: Entry) {
    this.publish(id, { card: entry.queue.reduce((card, item) => applyControl(card, item.command), entry.confirmed), pending: entry.queue.length > 0, error: entry.error });
  }

  private async run(id: string, entry: Entry) {
    while (entry.queue.length) {
      const next = entry.queue[0];
      try {
        const card = await next.transport(next.command);
        if (card?.entity_id !== id || !card.attrs || typeof card.state !== 'string') throw Error('Could not confirm the device state.');
        entry.confirmed = card;
        entry.error = '';
      } catch (error) {
        entry.error = error instanceof Error ? error.message : 'Could not update device.';
      }
      entry.queue.shift();
      this.emit(id, entry);
    }
  }
}
