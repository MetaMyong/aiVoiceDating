// ttsProcess.js - Google TTS + Fish Audio REST 통합
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const axios = require('axios');

// No config.json usage. Use environment variables or defaults.
let CONFIG = {};
const GOOGLE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || CONFIG.googleApplicationCredentials;
if (GOOGLE_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = GOOGLE_CREDENTIALS;

// Google Cloud TTS removed - Gemini TTS is the primary provider now.

// ANSI colors
const COLOR_ORANGE = '\x1b[33m'; // yellow/orange for TTS request prefixes
const COLOR_RESET = '\x1b[0m';

function now() { return new Date().toISOString() + ' '; }
const START_HR = process.hrtime.bigint();
function nowDelta() { const delta = Number(process.hrtime.bigint() - START_HR) / 1e6; return `${new Date().toISOString()} +${delta.toFixed(3)}ms `; }

// Concurrency control for parallel TTS synths
const MAX_PARALLEL = (process.env.TTS_MAX_PARALLEL ? Number(process.env.TTS_MAX_PARALLEL) : (CONFIG.ttsMaxParallel && Number(CONFIG.ttsMaxParallel)) || 3);
let _activeSynths = 0;
const _waitQueue = [];
async function _acquire() {
  if (_activeSynths < MAX_PARALLEL) { _activeSynths++; return; }
  await new Promise(resolve => _waitQueue.push(resolve));
  _activeSynths++;
}
function _release() {
  _activeSynths = Math.max(0, _activeSynths - 1);
  const r = _waitQueue.shift(); if (r) r();
}

function sanitizeChunk(text) {
  if (!text || !text.trim()) return null;
  let t = text.trim();
  // Remove leading ISO timestamp in square brackets added by LLM output, e.g. [2025-09-29T12:34:56.789Z]
  t = t.replace(/^\[\d{4}-\d{2}-\d{2}T[^\]]+\]\s*/, '');
  t = t.replace(/`[^`]*`/g, '');
  t = t.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  t = t.replace(/\[(.*?)\]\((?:.*?)\)/g, '$1');
  t = t.replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+/gu, '');
  t = t.replace(/([!\?\.,]){2,}/g, '$1');
  t = t.replace(/[`*_]{1,3}/g, '');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

const cp = require('child_process');

// Helper: wrap raw PCM (L16) into a RIFF WAV header so ffmpeg can read it
function pcmToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1) {
  const bytesPerSample = 2; // L16 => 16 bits = 2 bytes
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM header size
  header.writeUInt16LE(1, 20); // audio format 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// Create an audio resource from a file path. Prefer project-local ffmpeg.exe (next to this file)
// or use FFMPEG_PATH env var, else fall back to system 'ffmpeg'. This is module-level so
// both streamAndPlay and streamFromGenerator can use it.
function makeAudioResourceFromFile(fp) {
  const { createAudioResource, StreamType } = require('@discordjs/voice');
  const { createReadStream } = require('fs');
  const ext = (path.extname(fp) || '').toLowerCase().replace('.', '');
  const needsTranscode = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg'].includes(ext);
  if (needsTranscode) {
    try {
      // Quick header dump to help diagnose invalid input errors seen in ffmpeg
      try {
        const h = fs.readFileSync(fp, { encoding: null, start: 0, end: 31 });
        console.log(`${nowDelta()}[TTS][ffmpeg] file header=${h.slice(0,12).toString('ascii').replace(/[^ -~]/g, '.')}`);
      } catch (e) { /* ignore header read errors */ }
      // If file is suspiciously small, skip ffmpeg and stream the file directly
      try {
        const st = fs.statSync(fp);
        if (!st || typeof st.size !== 'number' || st.size < 44) {
          console.warn(`${nowDelta()}[TTS][ffmpeg] skipping ffmpeg for small/invalid file (${fp}) size=${st && st.size}`);
          return createAudioResource(createReadStream(fp));
        }
      } catch (e) {
        console.warn(`${nowDelta()}[TTS][ffmpeg] stat failed for ${fp}, falling back to file stream`, e && e.message ? e.message : e);
        return createAudioResource(createReadStream(fp));
      }
      // prefer project-local ffmpeg.exe placed next to this file (project root)
      let ffmpegCmd = process.env.FFMPEG_PATH || path.join(__dirname, 'ffmpeg.exe');
      if (!fs.existsSync(ffmpegCmd)) ffmpegCmd = process.env.FFMPEG_PATH || 'ffmpeg';
      const args = ['-i', fp, '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'];
  console.log(`${nowDelta()}[TTS][ffmpeg] spawn: ${ffmpegCmd} ${args.join(' ')}`);
  const ff = cp.spawn(ffmpegCmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.on('error', (err) => { console.warn(`${nowDelta()}[TTS][ffmpeg] spawn failed:`, err && err.message ? err.message : err); });
  ff.stderr.on('data', (d) => { try { console.log(`${nowDelta()}[TTS][ffmpeg][stderr]`, d.toString().trim()); } catch(e){} });
  ff.on('exit', (code, sig) => { console.log(`${nowDelta()}[TTS][ffmpeg] exit code=${code} signal=${sig}`); });
  return createAudioResource(ff.stdout, { inputType: StreamType.Raw });
    } catch (e) {
      console.warn('Failed to spawn ffmpeg for', fp, e && e.message ? e.message : e);
    }
  }
  // Fallback: raw file stream
  return createAudioResource(createReadStream(fp));
}

async function synthChunkSync(textChunk, index = 0) {
  // Prefer environment variables over any in-memory CONFIG
  const preferred = (process.env.TTS_PROVIDER || CONFIG.ttsProvider || '').toString().toLowerCase();
  const fishKey = process.env.FISH_AUDIO_API_KEY || CONFIG.fishAudioApiKey;
  const fishModelId = process.env.FISH_AUDIO_MODEL_ID || CONFIG.fishAudioModelId;
  
  // Try FishAudio FIRST if provider is fishaudio and credentials exist
  const preferFish = preferred === 'fishaudio' || preferred === 'fish';
  if (preferFish && fishKey && fishModelId) {
    try {
      const url = `https://api.fish.audio/v1/tts`;
      const requestBody = {
        temperature: 0.7,
        top_p: 0.7,
        prosody: {},
        chunk_length: 100,
        normalize: false,
        format: 'mp3',
        mp3_bitrate: 128,
        opus_bitrate: 32,
        latency: 'balanced',
        text: textChunk,
        references: [],
        reference_id: fishModelId
      };
      const axiosConfig = {
        headers: {
          Authorization: `Bearer ${fishKey}`,
          'Content-Type': 'application/json',
          model: CONFIG.fishAudioModelHeader || 's1'
        },
        responseType: 'arraybuffer'
      };
      console.log(`${nowDelta()}${COLOR_ORANGE}[FishAudio][Request][idx=${index}]${COLOR_RESET}`, requestBody);
      const resp = await axios.post(url, requestBody, axiosConfig);
      console.log(`${nowDelta()}[FishAudio][Response][idx=${index}] status=${resp.status} bytes=${resp.data ? resp.data.byteLength : 0}`);
      const tmp = path.join(os.tmpdir(), `ai_date_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.mp3`);
      fs.writeFileSync(tmp, Buffer.from(resp.data));
      return tmp;
    } catch (e) {
      console.warn('Fish Audio synth failed, falling back to Gemini TTS', e.response ? { status: e.response.status, data: e.response.data } : e.message || e);
    }
  }

  // Try Gemini TTS if preferred or fallback
  const preferGemini = preferred === 'gemini' || preferred === 'gemini-tts';
  const GEMINI_KEY = process.env.GEMINI_API_KEY || CONFIG.geminiApiKey;
  if ((preferGemini || !preferFish) && GEMINI_KEY) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
      const model = CONFIG.geminiTtsModel || 'gemini-2.5-flash-preview-tts';
      const voiceName = (process.env.GEMINI_TTS_VOICE || CONFIG.geminiTtsVoiceName || 'Zephyr');
      const config = {
        temperature: 0.7,
        responseModalities: ['audio'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      };
      const contents = [{ role: 'user', parts: [{ text: textChunk }] }];
      console.log(`${nowDelta()}${COLOR_ORANGE}[GeminiTTS][Request][idx=${index}]${COLOR_RESET}`, { model, voiceName });
      const stream = await ai.models.generateContentStream({ model, config, contents });
      for await (const chunk of stream) {
        try {
          const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inline && inline.data) {
              const mime = inline.mimeType || '';
              let ext = 'wav';
              try { ext = require('mime').getExtension(mime) || ext; } catch (e) {}
              const tmp = path.join(os.tmpdir(), `ai_date_gemini_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`);
              // inline.data may be a base64 string, a data: URI, or a Uint8Array/ArrayBuffer.
              let buffer;
              try {
                if (typeof inline.data === 'string') {
                  let s = inline.data;
                  const m = s.match(/^data:.*;base64,(.*)$/);
                  if (m) s = m[1];
                  buffer = Buffer.from(s, 'base64');
                } else if (inline.data && (inline.data instanceof Uint8Array || inline.data.buffer instanceof ArrayBuffer)) {
                  // handle Uint8Array or ArrayBuffer-like
                  buffer = Buffer.from(inline.data);
                } else if (Array.isArray(inline.data)) {
                  buffer = Buffer.from(inline.data);
                } else {
                  // last-resort try
                  buffer = Buffer.from(String(inline.data || ''), 'base64');
                }
              } catch (e) {
                console.warn(`${nowDelta()}[GeminiTTS][Response][idx=${index}] decode failed`, e && e.message ? e.message : e);
                buffer = Buffer.from('');
              }
              // If the mime suggests raw PCM/L16, wrap into a RIFF WAV container so ffmpeg can read it
              try {
                const mlow = (mime || '').toLowerCase();
                if (mlow.includes('l16') || mlow.includes('pcm') || mlow.includes('audio/l16')) {
                  // try to infer channels/rate from mime; default to 1 channel, 24000Hz
                  let rate = 24000; let channels = 1;
                  const rmatch = mlow.match(/rate=(\d+)/);
                  if (rmatch) rate = Number(rmatch[1]);
                  const cmatch = mlow.match(/channels=(\d+)/);
                  if (cmatch) channels = Number(cmatch[1]);
                  const wavBuf = pcmToWavBuffer(buffer, rate, channels);
                  fs.writeFileSync(tmp, wavBuf);
                  console.log(`${nowDelta()}[GeminiTTS][Response][idx=${index}] wrapped PCM->WAV mime=${mime} header=${wavBuf.slice(0,12).toString('ascii').replace(/[^ -~]/g, '.')} file=${tmp} bytes=${wavBuf.length}`);
                } else {
                  try { console.log(`${nowDelta()}[GeminiTTS][Response][idx=${index}] mime=${mime} header=${buffer.slice(0,16).toString('hex')} file=${tmp} bytes=${buffer.length}`); } catch(e){}
                  fs.writeFileSync(tmp, buffer);
                }
              } catch (e) {
                // fallback: write raw
                fs.writeFileSync(tmp, buffer);
              }
              return tmp;
          }
        } catch (e) { console.warn('Gemini TTS chunk parse failed', e && e.message ? e.message : e); }
      }
    } catch (e) {
      console.warn('Gemini TTS failed or @google/genai not available', e && e.message ? e.message : e);
    }
  }

  // Try Gemini TTS as fallback/default if configured
  const GEMINI_KEY_FALLBACK = process.env.GEMINI_API_KEY || CONFIG.geminiApiKey;
  if (GEMINI_KEY_FALLBACK) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      const ai = new GoogleGenAI({ apiKey: GEMINI_KEY_FALLBACK });
      const model = CONFIG.geminiTtsModel || 'gemini-2.5-flash-preview-tts';
      const voiceName = (process.env.GEMINI_TTS_VOICE || CONFIG.geminiTtsVoiceName || 'Zephyr');
      const config = {
        temperature: 0.7,
        responseModalities: ['audio'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
      };
      const contents = [{ role: 'user', parts: [{ text: textChunk }] }];
      console.log(`${nowDelta()}${COLOR_ORANGE}[GeminiTTS][FallbackRequest][idx=${index}]${COLOR_RESET}`, { model, voiceName });
      const stream = await ai.models.generateContentStream({ model, config, contents });
      for await (const chunk of stream) {
        try {
          const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inline && inline.data) {
              const mime = inline.mimeType || '';
              let ext = 'wav';
              try { ext = require('mime').getExtension(mime) || ext; } catch (e) {}
              const tmp = path.join(os.tmpdir(), `ai_date_gemini_tts_${Date.now()}_${Math.floor(Math.random()*10000)}.${ext}`);
              let buffer;
              try {
                if (typeof inline.data === 'string') {
                  let s = inline.data;
                  const m = s.match(/^data:.*;base64,(.*)$/);
                  if (m) s = m[1];
                  buffer = Buffer.from(s, 'base64');
                } else if (inline.data && (inline.data instanceof Uint8Array || inline.data.buffer instanceof ArrayBuffer)) {
                  buffer = Buffer.from(inline.data);
                } else if (Array.isArray(inline.data)) {
                  buffer = Buffer.from(inline.data);
                } else {
                  buffer = Buffer.from(String(inline.data || ''), 'base64');
                }
              } catch (e) {
                console.warn(`${nowDelta()}[GeminiTTS][FallbackResponse][idx=${index}] decode failed`, e && e.message ? e.message : e);
                buffer = Buffer.from('');
              }
              try {
                const mlow = (mime || '').toLowerCase();
                if (mlow.includes('l16') || mlow.includes('pcm') || mlow.includes('audio/l16')) {
                  let rate = 24000; let channels = 1;
                  const rmatch = mlow.match(/rate=(\d+)/);
                  if (rmatch) rate = Number(rmatch[1]);
                  const cmatch = mlow.match(/channels=(\d+)/);
                  if (cmatch) channels = Number(cmatch[1]);
                  const wavBuf = pcmToWavBuffer(buffer, rate, channels);
                  fs.writeFileSync(tmp, wavBuf);
                  console.log(`${nowDelta()}[GeminiTTS][FallbackResponse][idx=${index}] wrapped PCM->WAV mime=${mime} header=${wavBuf.slice(0,12).toString('ascii').replace(/[^ -~]/g, '.')} file=${tmp} bytes=${wavBuf.length}`);
                } else {
                  try { console.log(`${nowDelta()}[GeminiTTS][FallbackResponse][idx=${index}] mime=${mime} header=${buffer.slice(0,16).toString('hex')} file=${tmp} bytes=${buffer.length}`); } catch(e){}
                  fs.writeFileSync(tmp, buffer);
                }
              } catch (e) {
                fs.writeFileSync(tmp, buffer);
              }
              return tmp;
          }
        } catch (e) { console.warn('Gemini TTS fallback chunk parse failed', e && e.message ? e.message : e); }
      }
    } catch (e) {
      console.warn('Gemini TTS fallback failed or @google/genai not available', e && e.message ? e.message : e);
    }
  }

  // As a last resort, create a small placeholder audio file so playback can continue
  try {
    const tmp = path.join(os.tmpdir(), `ai_date_tts_placeholder_${Date.now()}_${Math.floor(Math.random()*10000)}.txt`);
    fs.writeFileSync(tmp, `TTS_PLACEHOLDER:\n${textChunk}`);
    return tmp;
  } catch (e) {
    console.error('Failed to create placeholder TTS file', e && e.message ? e.message : e);
    return null;
  }
}

async function streamAndPlay(player, text) {
  const { AudioPlayerStatus } = require('@discordjs/voice');

  const chunks = (text.match(/(.+?[\.\!\?\n]+|.+$)/g) || []).map(s => s.trim()).filter(Boolean);
  if (!chunks.length) return;

  // If Gemini TTS is selected, try to parse a tone directive from the first chunk
  let prefixTone = '';
  try {
  const tprov = (process.env.TTS_PROVIDER || CONFIG.ttsProvider || '').toString().toLowerCase();
    if (tprov.includes('gemini')) {
      // first chunk may look like: [TS] Say cheerfully: Hello there.
      const first = chunks[0] || '';
      const m = first.match(/^\s*\[?\d{4}-\d{2}-\d{2}T[^\]\s]*\]?\s*(.+?):\s*(.*)$/);
      if (m) {
        prefixTone = m[1].trim();
        // replace first chunk with the remainder after the colon
        chunks[0] = m[2] || '';
      } else {
        // also accept raw 'Say cheerfully: ...' without timestamp
        const m2 = first.match(/^\s*([^:]{1,40}):\s*(.*)$/);
        if (m2) { prefixTone = m2[1].trim(); chunks[0] = m2[2] || ''; }
      }
    }
  } catch (e) { /* ignore config read errors */ }

  // Start synthesis for all chunks concurrently, applying prefixTone when set
  const synthPromises = chunks.map((c, idx) => {
    let san = sanitizeChunk(c);
    if (!san) return Promise.resolve(null);
    if (prefixTone) {
      // Prepend the tone in a short form: "Say cheerfully: <text>" becomes "Say cheerfully: <text>"
      san = `${prefixTone}: ${san}`;
    }
    return synthChunkSync(san, idx);
  });

  // Play in original order as synth results become available
  for (let i = 0; i < synthPromises.length; i++) {
    try {
      const fp = await synthPromises[i];
      if (!fp) continue;
      console.log(`[TTS][Play] idx=${i} file=${fp}`);
  const resource = makeAudioResourceFromFile(fp);

      // If player is currently playing, wait until idle
      if (player.state.status === AudioPlayerStatus.Playing) {
        await new Promise(resolve => {
          const onState = (oldState, newState) => {
            if (newState.status === AudioPlayerStatus.Idle) {
              player.off('stateChange', onState);
              resolve();
            }
          };
          player.on('stateChange', onState);
        });
      }

      player.play(resource);
      console.log(`${nowDelta()}[TTS][Player] play invoked idx=${i}`);
      // wait for this resource to finish
      await new Promise((resolve) => {
        const onState = (oldState, newState) => {
          console.log(`${nowDelta()}[TTS][Player] stateChange idx=${i} ${oldState.status} -> ${newState.status}`);
          if (newState.status === AudioPlayerStatus.Idle) {
            player.off('stateChange', onState);
            resolve();
          }
        };
        player.on('stateChange', onState);
      });

      console.log(`[TTS][Done] idx=${i}`);
      try { await fs.unlink(fp); } catch (e) {}
    } catch (e) {
      console.error(`[TTS][Error] idx=${i}`, e.response ? e.response.data : e.message || e);
    }
  }
}

module.exports = { sanitizeChunk, synthChunkSync, streamAndPlay };

// Stream from an async iterator that yields sentences. For each sentence, start synth immediately
// and play results in original order as they become available.
async function streamFromGenerator(player, asyncIterator) {
  const { createAudioResource } = require('@discordjs/voice');
  const { createReadStream } = require('fs');
  const { AudioPlayerStatus } = require('@discordjs/voice');

  const synthPromises = [];
  const resolvers = {};
  let finished = false;
  // Tone parsing state for Gemini TTS: parsed once from the first sentence
  let prefixTone = '';
  let prefixToneParsed = false;

  // Start playback loop
  (async () => {
    let i = 0;
    while (!finished || i < synthPromises.length) {
      if (!synthPromises[i]) {
        // wait until promise for this index is set
        await new Promise(res => { resolvers[i] = res; });
      }
      const fp = await synthPromises[i];
      if (fp) {
  const resource = makeAudioResourceFromFile(fp);
        // wait if currently playing
        if (player.state.status === AudioPlayerStatus.Playing) {
          await new Promise(resolve => {
            const onState = (oldS, newS) => {
              if (newS.status === AudioPlayerStatus.Idle) { player.off('stateChange', onState); resolve(); }
            };
            player.on('stateChange', onState);
          });
        }
        player.play(resource);
        console.log(`${nowDelta()}[TTS][Player] play invoked (streamFromGenerator) idx=${i}`);
        await new Promise((resolve) => {
          const onState = (oldS, newS) => {
            console.log(`${nowDelta()}[TTS][Player] stateChange (streamFromGenerator) idx=${i} ${oldS.status} -> ${newS.status}`);
            if (newS.status === AudioPlayerStatus.Idle) { player.off('stateChange', onState); resolve(); }
          };
          player.on('stateChange', onState);
        });
        try { await fs.unlink(fp); } catch (e) {}
      }
      i++;
    }
  })();

  // Consume iterator and start synth for each sentence
  let idx = 0;
  try {
    for await (const sentence of asyncIterator) {
      // sentence is like '[TS] text' -- parse tone directive from the first sentence when Gemini TTS is selected
      const sanRaw = String(sentence || '').trim();
      let san = sanitizeChunk(sanRaw);
      if (san && !prefixToneParsed) {
        // Decide if we should parse a tone directive
        try {
          const cfg = fs.readJsonSync(path.resolve(__dirname, 'config.json')) || {};
          const tprov = (process.env.TTS_PROVIDER || cfg.ttsProvider || '').toString().toLowerCase();
          if (tprov.includes('gemini')) {
            // Try patterns: 'Tone: rest...' or 'Say cheerfully: rest...'
            const m = san.match(/^([^:]{1,40}):\s*(.*)$/);
            if (m) {
              prefixTone = m[1].trim();
              san = (m[2] || '').trim();
            }
          }
        } catch (e) {}
        prefixToneParsed = true;
      }
      if (!san) { synthPromises[idx] = null; if (resolvers[idx]) resolvers[idx](); idx++; continue; }
      // Start synthesis immediately in a background async IIFE so the HTTP request
      // is initiated as soon as the sentence is received.
      // If a tone prefix is present, prefix every sentence with it before synth
      let toSynth = san;
      if (prefixTone) toSynth = `${prefixTone}: ${san}`;
      synthPromises[idx] = (async (s, i) => {
        await _acquire();
        try {
          try { console.log(`${nowDelta()}${COLOR_ORANGE}[TTS][StartSynth][idx=${i}]${COLOR_RESET}`, toSynth); } catch(e) {}
          return await synthChunkSync(toSynth, i);
        } finally { _release(); }
      })(toSynth, idx);
      if (resolvers[idx]) { resolvers[idx](); delete resolvers[idx]; }
      idx++;
    }
  } finally {
    finished = true;
    // resolve any waiting resolvers so playback loop can finish
    Object.values(resolvers).forEach(r => r());
  }
}

module.exports = { sanitizeChunk, synthChunkSync, streamAndPlay, streamFromGenerator };
