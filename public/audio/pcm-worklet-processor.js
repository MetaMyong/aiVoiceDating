class PCMPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.readIndex = 0;
    this.channelCount = 1;
    this.sampleRate = sampleRate; // worklet's sample rate
    this.targetSampleRate = sampleRate;
    this.gain = 1.0;
    this.bytesPerSample = 2; // s16le

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'format') {
        this.channelCount = msg.channels || 1;
        this.targetSampleRate = msg.sampleRate || this.sampleRate;
        this.gain = typeof msg.gain === 'number' ? msg.gain : 1.0;
        return;
      }
      if (msg.type === 'chunk' && (msg.buffer instanceof ArrayBuffer || ArrayBuffer.isView(msg.buffer))) {
        const ab = msg.buffer instanceof ArrayBuffer ? msg.buffer : msg.buffer.buffer;
        this.buffer.push(new Int16Array(ab));
        return;
      }
      if (msg.type === 'clear') {
        this.buffer = [];
        this.readIndex = 0;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const channels = Math.max(1, this.channelCount);
    // Fill silence if no data
    if (this.buffer.length === 0) {
      for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
      return true;
    }

    const frameCount = output[0].length;
    let src = this.buffer[0];
    let srcIndex = this.readIndex;

    for (let i = 0; i < frameCount; i++) {
      if (!src || srcIndex >= src.length) {
        this.buffer.shift();
        this.readIndex = 0;
        src = this.buffer[0];
        srcIndex = 0;
        if (!src) {
          for (let ch = 0; ch < output.length; ch++) output[ch].subarray(i).fill(0);
          return true;
        }
      }

      // Interleaved s16le -> Float32
      for (let ch = 0; ch < output.length; ch++) {
        const s = src[srcIndex++];
        output[ch][i] = Math.max(-1, Math.min(1, (s / 32768) * this.gain));
      }
      for (let ch = output.length; ch < channels; ch++) srcIndex++;
      this.readIndex = srcIndex;
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PCMPlayerProcessor);
