import { WS_BASE } from "./config";

export interface VoiceSocketHandlers {
  onOpen(): void;
  onClose(): void;
  onEvent(msg: any): void;
  onAudio(buf: ArrayBuffer): void;
}

export class VoiceSocket {
  private handlers: VoiceSocketHandlers;
  private closed = false;
  private ws!: WebSocket;
  private nextTurnId = 0;
  private nextControlId = 0;
  private controls = new Map<string, { entityId: string; resolve: (card: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private activeTurnId: number | null = null;
  private audioTurnId: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(handlers: VoiceSocketHandlers) {
    this.handlers = handlers;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(WS_BASE + "/ws");
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    const current = () => !this.closed && this.ws === ws;
    ws.onopen = () => { if (current()) this.handlers.onOpen(); };
    ws.onclose = () => {
      if (!current()) return;
      this.activeTurnId = this.audioTurnId = null;
      this.failControls();
      this.handlers.onClose();
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data === "string") {
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "control_result") {
          const pending = this.controls.get(msg.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.controls.delete(msg.requestId);
          if (msg.ok && msg.card?.entity_id === pending.entityId) pending.resolve(msg.card);
          else pending.reject(new Error(msg.message || "Could not confirm the device state."));
          return;
        }
        if (msg.type === "audio") {
          this.audioTurnId = msg.turnId === this.activeTurnId ? msg.turnId : null;
        } else if (msg.turnId === undefined || msg.turnId === this.activeTurnId) {
          this.handlers.onEvent(msg);
        }
      } else {
        const accept = this.activeTurnId !== null && this.audioTurnId === this.activeTurnId;
        this.audioTurnId = null;
        if (accept) this.handlers.onAudio(event.data);
      }
    };
  }

  get ready() {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  sendControl(message: any) {
    if (this.ready) this.ws.send(JSON.stringify(message));
  }

  requestControl(message: any, timeoutMs = 12000): Promise<any> {
    if (!this.ready) return Promise.reject(new Error("Connection unavailable. Reconnect and try again."));
    const requestId = `control-${++this.nextControlId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.controls.delete(requestId);
        reject(new Error("Could not confirm the change in time. Check the device before retrying."));
      }, timeoutMs);
      this.controls.set(requestId, { entityId: message.entity_id, resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ ...message, requestId })); }
      catch { clearTimeout(timer); this.controls.delete(requestId); reject(new Error("Connection unavailable.")); }
    });
  }

  private failControls() {
    for (const pending of this.controls.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection lost. Could not confirm the change."));
    }
    this.controls.clear();
  }

  sendAudio(arrayBuffer: ArrayBuffer, imageIds: string[] = []) {
    if (!this.ready) throw new Error("Voice connection is closed");
    this.activeTurnId = ++this.nextTurnId;
    this.audioTurnId = null;
    this.ws.send(JSON.stringify({ type: "voice_start", turnId: this.activeTurnId, imageIds }));
    this.ws.send(arrayBuffer);
  }

  sendImages(imageIds: string[]) {
    if (!this.ready) throw new Error("Voice connection is closed");
    this.activeTurnId = ++this.nextTurnId;
    this.audioTurnId = null;
    this.ws.send(JSON.stringify({ type: "voice_images", turnId: this.activeTurnId, imageIds }));
  }

  cancelTurn() {
    this.activeTurnId = this.audioTurnId = null;
    this.sendControl({ type: "cancel" });
  }

  close() {
    this.closed = true;
    this.failControls();
    clearTimeout(this.reconnectTimer);
    this.activeTurnId = this.audioTurnId = null;
    this.ws.close();
  }
}
