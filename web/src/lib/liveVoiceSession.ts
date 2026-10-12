import { haptics } from "./haptics";
import { LiveIdleClock, LiveTranscript } from "./liveVoiceState";

interface LiveOptions { providerId: string; voice: string }
interface Handlers {
  status(value: "starting" | "listening" | "recording" | "speaking" | "thinking"): void;
  caption(role: "user" | "assistant", text: string): void;
  level(value: number, microphone: number): void;
  search?(event: any): void;
  memory?(event: any): void;
  ended(reason: string, turns: { role: "user" | "assistant"; text: string }[]): void;
}

/** One explicitly-started WebRTC session; never retries a paid creation. */
export class LiveVoiceSession {
  private releaseHaptics?: () => void;
  private readonly id = crypto.randomUUID().replace(/-/g, "");
  private peer: RTCPeerConnection | null = null;
  private events: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private output: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private micMeter: AnalyserNode | null = null;
  private outputMeter: AnalyserNode | null = null;
  private meters: MediaStreamAudioSourceNode[] = [];
  private meterData = new Float32Array(512);
  private interval: ReturnType<typeof setInterval> | undefined;
  private startup: ReturnType<typeof setTimeout> | undefined;
  private closingTimer: ReturnType<typeof setTimeout> | undefined;
  private creationStarted = false;
  private closed = false;
  private ready = false;
  private lastHeartbeat = 0;
  private heartbeatPending = false;
  private userActiveUntil = 0;
  private outputActiveUntil = 0;
  private clock = new LiveIdleClock(0);
  private transcript = new LiveTranscript();
  private seen = new Set<string>();
  private statusValue = "";
  private tasks = new Set<string>();
  private pendingTasks = 0;
  private taskController = new AbortController();

  constructor(private handlers: Handlers) {}

  async start(options: LiveOptions) {
    this.status("starting");
    this.releaseHaptics = haptics.suppress();
    this.startup = setTimeout(() => this.end("Live connection timed out. Tap the microphone to try again."), 30_000);
    try {
      this.context = new AudioContext();
      await this.context.resume();
      if (this.closed) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.microphone = stream;
      this.micMeter = this.meter(stream);
      this.peer = new RTCPeerConnection();
      this.output = new Audio();
      this.output.autoplay = true;
      this.output.setAttribute("playsinline", "");
      this.peer.ontrack = event => {
        if (this.closed || !this.output) return;
        const remote = new MediaStream([event.track]);
        this.output.srcObject = remote;
        this.outputMeter = this.meter(remote);
        void this.output.play().catch(() => this.end("Couldn't play Live audio. Tap the microphone to reconnect."));
      };
      this.peer.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(this.peer?.connectionState ?? "")) this.end("Live connection ended. Tap the microphone to reconnect.");
      };
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        track.onended = () => this.end("The microphone disconnected.");
        this.peer.addTrack(track, stream);
      }
      this.events = this.peer.createDataChannel("oai-events");
      this.events.onmessage = event => this.receive(event.data);
      this.events.onclose = () => { if (!this.closed) this.end("Live connection ended. Tap the microphone to reconnect."); };
      this.events.onerror = () => this.end("Live connection failed. Tap the microphone to reconnect.");
      await this.peer.setLocalDescription(await this.peer.createOffer());
      if (this.closed) return;
      await this.gatherIce(this.peer);
      if (this.closed) return;
      this.creationStarted = true;
      const response = await fetch("/api/live/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: this.id, ...options, sdp: this.peer.localDescription!.sdp }),
        signal: AbortSignal.timeout(25_000),
      });
      const body = await response.json();
      if (this.closed) { this.closeRemote(); return; }
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't start Live voice.");
      if (typeof body.sdp !== "string") throw new Error("Invalid Live connection response.");
      await this.peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
      if (!this.closed) this.interval = setInterval(() => this.tick(), 100);
    } catch (error) {
      this.end(error instanceof Error && error.name !== "TypeError" ? error.message : "Couldn't start Live voice. Check microphone access and your connection.");
    }
  }

  private gatherIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); peer.removeEventListener("icegatheringstatechange", changed); resolve(); };
      const changed = () => { if (peer.iceGatheringState === "complete") done(); };
      const timer = setTimeout(() => { peer.removeEventListener("icegatheringstatechange", changed); reject(new Error("Couldn't connect Live audio through this network.")); }, 8000);
      peer.addEventListener("icegatheringstatechange", changed);
    });
  }
  private meter(stream: MediaStream) {
    const source = this.context!.createMediaStreamSource(stream);
    const meter = this.context!.createAnalyser();
    meter.fftSize = 512;
    source.connect(meter);
    this.meters.push(source);
    return meter;
  }
  private energy(meter: AnalyserNode | null) {
    if (!meter) return 0;
    meter.getFloatTimeDomainData(this.meterData);
    return Math.sqrt(this.meterData.reduce((sum, value) => sum + value * value, 0) / this.meterData.length);
  }
  private status(value: "starting" | "listening" | "recording" | "speaking" | "thinking") {
    if (this.closed || value === this.statusValue) return;
    this.statusValue = value;
    this.handlers.status(value);
  }
  private tick() {
    if (this.closed) return;
    const now = performance.now();
    if (now - this.lastHeartbeat >= 5000 && !this.heartbeatPending) {
      this.lastHeartbeat = now;
      this.heartbeatPending = true;
      void fetch(`/api/live/sessions/${this.id}/heartbeat`, { method: "POST", signal: AbortSignal.timeout(5000) })
        .then(response => { if (!response.ok) this.end("Live voice was disabled or the session ended."); })
        .catch(() => this.end("Live connection was lost. Tap the microphone to reconnect."))
        .finally(() => { this.heartbeatPending = false; });
    }
    if (!this.ready) return;
    const mic = this.energy(this.micMeter);
    const output = this.energy(this.outputMeter);
    if (mic > 0.015) this.userActiveUntil = now + 400;
    if (output > 0.005) this.outputActiveUntil = now + 400;
    const userActive = now < this.userActiveUntil;
    const outputActive = now < this.outputActiveUntil;
    this.clock.setBusy(userActive || outputActive || this.pendingTasks > 0, now);
    if (userActive || outputActive) this.clock.activity(now);
    this.status(outputActive ? "speaking" : userActive ? "recording" : this.pendingTasks ? "thinking" : "listening");
    this.handlers.level(Math.min(1, output * 12), Math.min(1, mic * 5));
    if (this.clock.expired(now)) this.end("Live session ended after 30 seconds of inactivity.");
  }
  private receive(raw: unknown) {
    let event: any;
    try { event = JSON.parse(String(raw)); } catch { return; }
    if (event.type === "session.closed") { if (!this.closed) this.end("Live session ended."); this.releaseTransport(); return; }
    if (this.closed) return;
    if (typeof event.event_id === "string") {
      if (this.seen.has(event.event_id)) return;
      this.seen.add(event.event_id);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    }
    if (event.type === "session.started") {
      clearTimeout(this.startup);
      this.ready = true;
      this.clock = new LiveIdleClock(performance.now());
      this.microphone?.getAudioTracks().forEach(track => { track.enabled = true; });
      this.status("listening");
    } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)) return;
      const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      this.transcript.append(role, event.delta, event.start_ms, event.end_ms);
      this.handlers.caption(role, this.transcript.caption(role));
      this.clock.activity(performance.now());
    } else if (event.type === "session.delegation.created" && typeof event.delegation?.id === "string") {
      if (event.delegation.target === "client") void this.delegate(event.delegation.id);
    } else if (event.type === "error") this.end("OpenAI Live voice reported an error. End the session and check your account or connection.");
  }
  private async delegate(id: string) {
    if (this.tasks.has(id) || this.closed) return;
    this.tasks.add(id);
    this.pendingTasks++;
    this.clock.setBusy(true, performance.now());
    try {
      // Transcript fragments can follow the delegation event on the channel.
      await new Promise(resolve => setTimeout(resolve, 350));
      if (this.closed) return;
      let budget = 20_000;
      const turns = this.transcript.turns().slice(-40).reverse().flatMap(turn => {
        if (budget <= 0) return [];
        const text = turn.text.slice(-Math.min(4000, budget));
        budget -= text.length;
        return [{ ...turn, text }];
      }).reverse();
      const response = await fetch(`/api/live/sessions/${this.id}/delegate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delegationId: id, turns }),
        signal: AbortSignal.any([this.taskController.signal, AbortSignal.timeout(90_000)]),
      });
      const result = await response.json();
      if (this.closed) return;
      if (!response.ok || typeof result.content !== "string") throw new Error("Live tool request failed");
      for (const memory of result.memory ?? []) this.handlers.memory?.(memory);
      for (const search of result.searches ?? []) this.handlers.search?.(search);
      this.send({ type: "session.commentary.append", event_id: `result_${id}`, delegation_id: id, content: result.content });
    } catch {
      if (!this.closed) this.send({ type: "session.commentary.append", event_id: `error_${id}`, delegation_id: id,
        content: "The tool request could not be completed or confirmed. Some actions may have run. Do not repeat them automatically; check the state first." });
    } finally {
      this.pendingTasks--;
      this.clock.activity(performance.now());
    }
  }

  private send(event: Record<string, unknown>) {
    if (this.events?.readyState === "open") this.events.send(JSON.stringify(event));
  }
  private closeRemote() {
    if (this.creationStarted) void fetch(`/api/live/sessions/${this.id}/close`, { method: "POST", keepalive: true }).catch(() => {});
  }
  end(reason = "") {
    if (this.closed) return;
    this.closed = true;
    this.taskController.abort();
    clearTimeout(this.startup);
    clearInterval(this.interval);
    this.microphone?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.releaseHaptics?.();
    this.releaseHaptics = undefined;
    this.output?.pause();
    if (this.output) this.output.srcObject = null;
    this.meters.forEach(source => source.disconnect());
    void this.context?.close().catch(() => {});
    this.handlers.level(0, 0);
    this.send({ type: "session.close" });
    this.closeRemote();
    this.closingTimer = setTimeout(() => this.releaseTransport(), 2000);
    this.handlers.ended(reason, this.transcript.turns());
  }
  private releaseTransport() {
    clearTimeout(this.closingTimer);
    this.events?.close();
    this.peer?.close();
  }
}
