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

  constructor(handlers: VoiceSocketHandlers) {
    this.handlers = handlers;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(WS_BASE + "/ws");
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => this.handlers.onOpen();
    this.ws.onclose = () => {
      this.handlers.onClose();
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    };
    this.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        this.handlers.onEvent(JSON.parse(event.data));
      } else {
        this.handlers.onAudio(event.data);
      }
    };
  }

  get ready() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  sendControl(message: any) {
    if (this.ready) this.ws.send(JSON.stringify(message));
  }

  sendAudio(arrayBuffer: ArrayBuffer) {
    this.ws.send(arrayBuffer);
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}
