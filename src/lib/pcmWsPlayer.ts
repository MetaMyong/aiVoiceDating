// Minimal WS PCM player using AudioWorklet for low-latency playback
export type PCMFormat = { sampleRate: number; channels: number; sampleFormat?: 's16le' };

export class PCMWebSocketPlayer {
  private ws: WebSocket | null = null;
  private url: string;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private format: PCMFormat | null = null;
  private started = false;
  private connected = false;
  private resolve?: () => void;
  private reject?: (e: any) => void;
  private bufferQueueBytes = 0;
  private desiredBufferMs = 120; // target jitter buffer

  constructor(url: string) { this.url = url; }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch {}
    }
    if (!this.node) {
      try {
        // load worklet if not loaded
        // In Vite, public path '/' should resolve to '/src/audio/...'? We'll import via URL and addModule
        // For robustness, we accept that caller will preload elsewhere. Try relative URL.
        const workletUrl = '/audio/pcm-worklet-processor.js';
        try { await (this.ctx as any).audioWorklet.addModule(workletUrl); } catch {}
        this.node = new AudioWorkletNode(this.ctx, 'pcm-player-processor');
        this.node.connect(this.ctx.destination);
      } catch (e) {
        console.error('[PCMWebSocketPlayer] Worklet init failed', e);
        throw e;
      }
    }
  }

  private post(msg: any) {
    if (this.node) this.node.port.postMessage(msg);
  }

  async start(params: { text: string; provider: string; apiKey: string; voice?: string; model?: string; fishModelId?: string; sampleRate?: number; }) {
    await this.ensureContext();
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve; this.reject = reject;
      this.started = true; this.connected = false; this.bufferQueueBytes = 0; this.format = null;
      const wsUrl = this.url;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.connected = true;
        ws.send(JSON.stringify({ type: 'start', ...params }));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.type === 'format') {
              this.format = { sampleRate: Number(msg.sampleRate)||44100, channels: Number(msg.channels)||1, sampleFormat: 's16le' };
              this.post({ type: 'format', sampleRate: this.format.sampleRate, channels: this.format.channels });
            } else if (msg?.type === 'end') {
              // drain done
              this.stopInternal();
              if (this.resolve) this.resolve();
            } else if (msg?.type === 'error') {
              const err = new Error(msg.message || 'WS tts error');
              this.stopInternal();
              if (this.reject) this.reject(err);
            }
          } catch {}
        } else if (ev.data instanceof ArrayBuffer) {
          // binary PCM chunk
          const ab = ev.data as ArrayBuffer;
          this.bufferQueueBytes += ab.byteLength;
          // feed to worklet
          this.post({ type: 'chunk', buffer: ab });
          // Optionally wait until initial buffer reached desired ms
          if (this.format && this.ctx && this.bufferQueueBytes > (this.format.sampleRate * this.format.channels * 2) * (this.desiredBufferMs/1000)) {
            // ok
          }
        }
      };
      ws.onerror = (e) => {
        if (this.reject) this.reject(e);
        this.stopInternal();
      };
      ws.onclose = () => {
        this.connected = false;
      };
    });
  }

  stopInternal() {
    try { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.close(); } catch {}
    this.ws = null;
    this.started = false;
    this.bufferQueueBytes = 0;
    this.format = null;
    this.post({ type: 'clear' });
  }

  async dispose() {
    this.stopInternal();
    try { if (this.node) this.node.disconnect(); } catch {}
    this.node = null;
    try { if (this.ctx) await this.ctx.close(); } catch {}
    this.ctx = null;
  }
}

export function buildWsUrl(path: string) {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}${path}`;
}