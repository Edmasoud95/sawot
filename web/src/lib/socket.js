import { WS_BASE } from "./config";

export class VoiceSocket {
  /**
   * @param {{ onOpen(): void, onClose(): void,
   *           onEvent(msg: object): void, onAudio(buf: ArrayBuffer): void }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.closed = false;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(`${WS_BASE}/ws`);
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

  sendControl(message) {
    if (this.ready) this.ws.send(JSON.stringify(message));
  }

  sendAudio(arrayBuffer) {
    this.ws.send(arrayBuffer);
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}
