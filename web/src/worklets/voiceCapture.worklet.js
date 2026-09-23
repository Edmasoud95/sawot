// Batch mono samples off the UI thread; never route the microphone to speakers.
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i];
      this.frame[this.offset++] = value / channels.length;
      if (this.offset === this.frame.length) {
        this.port.postMessage({ samples: this.frame, time: currentTime }, [this.frame.buffer]);
        this.frame = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
