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
      this.handlers.onClose();
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data === "string") {
        let msg: any;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (!msg || typeof msg !== "object") return;
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

  sendAudio(arrayBuffer: ArrayBuffer) {
    if (!this.ready) throw new Error("Voice connection is closed");
    this.activeTurnId = ++this.nextTurnId;
    this.audioTurnId = null;
    this.ws.send(JSON.stringify({ type: "voice_start", turnId: this.activeTurnId }));
    this.ws.send(arrayBuffer);
  }

  cancelTurn() {
    this.activeTurnId = this.audioTurnId = null;
    this.sendControl({ type: "cancel" });
  }

  close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.activeTurnId = this.audioTurnId = null;
    this.ws.close();
  }
}
