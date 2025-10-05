// server/index.cjs - Express 기반의 통합 서버 (CommonJS)
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const multer = require('multer');
const { getAiResponse, generateContentStream } = require('./llmModel.cjs');
const { audioToText } = require('./sttProcess.cjs');
const { synthChunkPCM } = require('./ttsProcess.cjs');
const { WebSocketServer } = require('ws');

const app = express();

// Disable buffering for SSE by disabling etag and setting keep-alive timeout
app.set('etag', false);
app.use(express.json());

// Multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// CORS 허용 (개발용)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return res.sendStatus(204);
  }
  next();
});

// LLM 생성 엔드포인트
app.post('/api/llm/generate', async (req, res) => {
  try {
    const { messages, model, apiKey, generationConfig } = req.body;
    
    console.log('[API] LLM generate request:', { 
      messageCount: messages?.length, 
      model,
      hasApiKey: !!apiKey,
      generationConfig
    });

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다' });
    }

    // Set API key and model in environment temporarily for this request
    if (apiKey) {
      process.env.GEMINI_API_KEY = apiKey;
    }
    if (model) {
      process.env.GEMINI_MODEL = model;
    }
    // Set generation config
    if (generationConfig) {
      process.env.GENERATION_CONFIG = JSON.stringify(generationConfig);
    }

    // Use built messages array verbatim on server side
    console.log('[API] Messages (generate):', messages);
    // Fallback: derive userText from last user message for non-streaming pathway
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const userText = lastUserMessage?.content || '';
    const response = await getAiResponse(null, userText);
    
    console.log('[API] AI response:', response);

    res.json({ text: response, success: true });

  } catch (error) {
    console.error('[API] LLM generate error:', error);
    res.status(500).json({ 
      error: 'LLM 응답 생성 실패', 
      message: error.message 
    });
  }
});// LLM 스트리밍 엔드포인트
app.post('/api/llm/stream', async (req, res) => {
  try {
  const { messages, model, apiKey, generationConfig } = req.body;
    
    console.log('[API] LLM stream request:', { 
      messageCount: messages?.length, 
      model,
      hasApiKey: !!apiKey,
      generationConfig
    });

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다' });
    }

    // Set API key and model in environment temporarily for this request
    if (apiKey) {
      process.env.GEMINI_API_KEY = apiKey;
    }
    if (model) {
      process.env.GEMINI_MODEL = model;
    }
    // Set generation config
    if (generationConfig) {
      process.env.GENERATION_CONFIG = JSON.stringify(generationConfig);
    }

    // For streaming, forward the full messages array to the LLM layer
    console.log('[API] Messages (stream):', messages);

    // Set SSE headers with immediate flush
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Transfer-Encoding', 'chunked');
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    // Directly call Gemini SSE and pipe raw SSE to client (example-style)
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!GEMINI_KEY) {
      res.write(`data: ${JSON.stringify({ error: 'Missing GEMINI_API_KEY' })}\n\n`);
      return res.end();
    }

  // Build Gemini JSON body from messages (system + contents)
  let jsonBody;
    if (Array.isArray(messages) && messages.length && Object.prototype.hasOwnProperty.call(messages[0], 'content')) {
      const systemTexts = messages.filter(m => m.role === 'system').map(m => String(m.content || '')).filter(Boolean);
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '') }]
      }));
      
      // Prepare generationConfig with thinking support and sanitize unsupported fields
      const rawGenConfig = generationConfig ? { ...generationConfig } : {};
      const finalGenConfig = {};

      // Whitelist supported generationConfig keys to avoid INVALID_ARGUMENT
      const allowKeys = new Set([
        'maxOutputTokens',
        'temperature',
        'topP',
        'topK',
        'candidateCount',
        'stopSequences',
        'responseMimeType',
        'responseModalities'
      ]);
      for (const [k, v] of Object.entries(rawGenConfig)) {
        if (k === 'thinkingTokens') continue; // handled below
        if (allowKeys.has(k) && v !== undefined) {
          finalGenConfig[k] = v;
        }
      }

      // Note: thinkingConfig is omitted for now to avoid API incompatibilities.
      
      // Note: safetySettings are omitted to avoid incompatibilities with changing API enums.
      // Rely on provider defaults unless explicitly configured by the client.
      jsonBody = {
        ...(systemTexts.length ? { systemInstruction: { parts: [{ text: systemTexts.join('\n') }] } } : {}),
        contents,
        ...(Object.keys(finalGenConfig).length > 0 ? { generationConfig: finalGenConfig } : {})
      };
    } else {
  jsonBody = { contents: [], ...(generationConfig ? { generationConfig } : {}) };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`;
    let _fetch = (typeof fetch === 'function') ? fetch : null;
    if (!_fetch) {
      try { _fetch = require('node-fetch'); } catch {}
    }
    if (!_fetch) {
      res.write(`data: ${JSON.stringify({ error: 'fetch not available' })}\n\n`);
      return res.end();
    }

    try {
      const upstream = await _fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonBody)
      });

      if (!upstream.ok) {
        const errTxt = await upstream.text().catch(() => '[no body]');
        console.error('[API] Upstream Gemini error', upstream.status, errTxt);
        res.write(`data: ${JSON.stringify({ error: `Gemini error ${upstream.status}`, detail: errTxt })}\n\n`);
        return res.end();
      }

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let aborted = false;
      // Abort upstream when client disconnects
      req.on('close', () => {
        aborted = true;
        try { reader.cancel(); } catch {}
      });
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (aborted) break;
        const out = decoder.decode(value, { stream: true });
        if (out) res.write(out);
      }
      res.end();
    } catch (e) {
      console.error('[API] Stream proxy error:', e);
      try { res.write(`data: ${JSON.stringify({ error: e.message || String(e) })}\n\n`); } catch {}
      res.end();
    }

  } catch (error) {
    console.error('[API] LLM stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'LLM 스트리밍 실패', 
        message: error.message 
      });
    }
  }
});

// STT 엔드포인트
app.post('/api/stt/transcribe', upload.single('audio'), async (req, res) => {
  try {
    console.log('[API] STT transcribe request received');
    
    if (!req.file) {
      return res.status(400).json({ error: '오디오 파일이 필요합니다' });
    }
    // Frontend에서 서비스 계정 JSON을 전송 (googleServiceKey)
    // 이전 병합에서 apiKey를 파일 경로로 오해하여 ENOENT 발생했음
    const googleServiceKey = req.body.googleServiceKey;

    console.log('[API] Audio file size:', req.file.size, 'bytes');
    console.log('[API] Audio file type:', req.file.mimetype);

    // Convert webm to wav if needed
    const audioBuffer = req.file.buffer;
    
    // Call STT
  const transcribedText = await audioToText(audioBuffer, googleServiceKey);
    
    console.log('[API] Transcribed text:', transcribedText);

    res.json({ text: transcribedText, success: true });

  } catch (error) {
    console.error('[API] STT error:', error);
    res.status(500).json({ 
      error: 'STT 처리 실패',
      message: error.message 
    });
  }
});

// TTS 엔드포인트 (PCM 직접 반환, 임시파일 없음)
app.post('/api/tts/synthesize', async (req, res) => {
  try {
    const { text, provider, apiKey, voice, model, fishModelId } = req.body;
    
    console.log('[API] TTS synthesize request:', { 
      textLength: text?.length,
      provider,
      voice: provider === 'gemini' ? voice : undefined,
      model,
      fishModelId: provider === 'fishaudio' ? fishModelId : undefined
    });

    if (!text) {
      return res.status(400).json({ error: '텍스트가 필요합니다' });
    }

    // Set API keys and provider-specific settings
    if (provider === 'gemini') {
      if (apiKey) process.env.GEMINI_API_KEY = apiKey;
      if (voice) process.env.GEMINI_TTS_VOICE = voice;
      if (model) process.env.GEMINI_TTS_MODEL = model;
      process.env.TTS_PROVIDER = 'gemini';
    } else if (provider === 'fishaudio') {
      if (apiKey) process.env.FISH_AUDIO_API_KEY = apiKey;
      if (fishModelId) process.env.FISH_AUDIO_MODEL_ID = fishModelId;
      process.env.TTS_PROVIDER = 'fishaudio';
    }

    // 합성: in-memory PCM
    const { buffer, sampleRate: sr, channels } = await synthChunkPCM(text, 0);
    if (!buffer || buffer.length === 0) {
      throw new Error('TTS 생성 실패(빈 PCM)');
    }
    res.setHeader('Content-Type', 'audio/pcm');
    res.setHeader('X-Audio-Sample-Rate', String(sr || 44100));
    res.setHeader('X-Audio-Channels', String(channels || 1));
    res.send(buffer);

  } catch (error) {
    console.error('[API] TTS error:', error);
    res.status(500).json({ 
      error: 'TTS 처리 실패',
      message: error.message 
    });
  }
});

// 순수 PCM을 반환하는 TTS 엔드포인트 (임시파일 없음)
// 응답 헤더에 샘플레이트/채널 정보를 포함해 클라이언트가 재생에 활용하도록 함
app.post('/api/tts/synthesize-pcm', async (req, res) => {
  try {
    const { text, provider, apiKey, voice, model, fishModelId, sampleRate } = req.body;

    console.log('[API] TTS synthesize-pcm request:', {
      textLength: text?.length,
      provider,
      voice: provider === 'gemini' ? voice : undefined,
      model,
      fishModelId: provider === 'fishaudio' ? fishModelId : undefined,
      sampleRate
    });

    if (!text) return res.status(400).json({ error: '텍스트가 필요합니다' });

    // Provider 설정
    if (provider === 'gemini') {
      if (apiKey) process.env.GEMINI_API_KEY = apiKey;
      if (voice) process.env.GEMINI_TTS_VOICE = voice;
      if (model) process.env.GEMINI_TTS_MODEL = model;
      process.env.TTS_PROVIDER = 'gemini';
    } else if (provider === 'fishaudio') {
      if (apiKey) process.env.FISH_AUDIO_API_KEY = apiKey;
      if (fishModelId) process.env.FISH_AUDIO_MODEL_ID = fishModelId;
      process.env.TTS_PROVIDER = 'fishaudio';
    }

    // 합성: in-memory PCM
    const { buffer, sampleRate: sr, channels } = await synthChunkPCM(text, 0);
    const finalSr = Number(sampleRate) || sr || 44100;
    const finalCh = channels || 1;

    res.setHeader('Content-Type', 'audio/pcm');
    res.setHeader('X-Audio-Sample-Rate', String(finalSr));
    res.setHeader('X-Audio-Channels', String(finalCh));
    res.send(buffer);
  } catch (error) {
    console.error('[API] TTS synthesize-pcm error:', error);
    res.status(500).json({ error: 'TTS 처리 실패', message: error.message });
  }
});

// Fish Audio 모델 목록 조회 엔드포인트
app.get('/api/fishaudio/models', async (req, res) => {
  try {
    const apiKeyQuery = req.query.apiKey;
    const authHeader = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
    const apiKey = apiKeyQuery || authHeader;
    if (!apiKey) return res.status(400).json({ error: 'Fish Audio API 키가 제공되지 않았습니다. 쿼리(apiKey) 또는 Authorization 헤더를 사용하세요.' });
    const url = 'https://api.fish.audio/model?self=true&sort_by=created_at';
    const r = await axios.get(url, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 });
    const data = r.data || {};
    const myModels = (data.items || []).filter(m => m.state === 'trained').map(m => ({ name: m.title, id: m._id, modelId: m.modelId || null }));
    return res.json({ models: myModels });
  } catch (e) {
    console.error('fishaudio models error', e.response ? e.response.data : e.message);
    const upstream = e.response ? e.response.data : undefined;
    return res.status(500).json({ error: 'FishAudio 모델 목록 조회 실패', upstream });
  }
});

// 정적 파일 서빙: dist 폴더
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  console.log('[server] serving dist at', distDir);
  app.use('/', express.static(distDir));
}

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Not found');
});

function startServer(port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`HTTP 서버 실행 중: http://127.0.0.1:${port}`);
      try {
        // WebSocket for PCM TTS streaming
        const wss = new WebSocketServer({ server, path: '/ws/tts' });
        wss.on('connection', (ws, req) => {
          let aborted = false;
          ws.on('close', () => { aborted = true; });
          ws.on('message', async (data) => {
            if (aborted) return;
            try {
              let msg;
              try { msg = JSON.parse(data.toString()); } catch { msg = null; }
              if (!msg || msg.type !== 'start') {
                return ws.send(JSON.stringify({ type: 'error', message: 'invalid start message' }));
              }
              const { text, provider, apiKey, voice, model, fishModelId, sampleRate } = msg;
              if (!text) {
                ws.send(JSON.stringify({ type: 'error', message: 'text required' }));
                return ws.close();
              }
              // Configure providers per request
              if (provider === 'gemini') {
                if (apiKey) process.env.GEMINI_API_KEY = apiKey;
                if (voice) process.env.GEMINI_TTS_VOICE = voice;
                if (model) process.env.GEMINI_TTS_MODEL = model;
                process.env.TTS_PROVIDER = 'gemini';
              } else if (provider === 'fishaudio') {
                if (apiKey) process.env.FISH_AUDIO_API_KEY = apiKey;
                if (fishModelId) process.env.FISH_AUDIO_MODEL_ID = fishModelId;
                process.env.TTS_PROVIDER = 'fishaudio';
              }

              // Best-effort streaming: Some providers return whole buffer; Gemini can be chunked.
              // Use synthChunkPCM as fallback to get full buffer then chunk.
              const { GoogleGenAI } = (() => { try { return require('@google/genai'); } catch { return {}; } })();
              const useGemini = provider === 'gemini' && GoogleGenAI;

              if (useGemini) {
                try {
                  const ai = new GoogleGenAI.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
                  const mdl = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
                  const cfg = { temperature: 0.7, responseModalities: ['audio'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Zephyr' } } } };
                  const contents = [{ role: 'user', parts: [{ text }] }];
                  const stream = await ai.models.generateContentStream({ model: mdl, config: cfg, contents });
                  let formatSent = false;
                  let knownRate = Number(sampleRate) || 0;
                  let knownCh = 0;
                  let wavBuffering = null; // if mime indicates wav, buffer to end
                  for await (const chunk of stream) {
                    if (aborted) break;
                    const inline = chunk?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
                    if (!inline || !inline.data) continue;
                    const mime = String(inline.mimeType || '').toLowerCase();
                    let buf;
                    if (typeof inline.data === 'string') {
                      let s = inline.data; const m = s.match(/^data:.*;base64,(.*)$/); if (m) s = m[1]; buf = Buffer.from(s, 'base64');
                    } else if (inline.data && (inline.data instanceof Uint8Array || inline.data.buffer instanceof ArrayBuffer)) {
                      buf = Buffer.from(inline.data);
                    } else if (Array.isArray(inline.data)) {
                      buf = Buffer.from(inline.data);
                    } else {
                      buf = Buffer.from(String(inline.data || ''), 'base64');
                    }
                    if (mime.includes('wav')) {
                      // Buffer WAV then extract at end
                      if (!wavBuffering) wavBuffering = [];
                      wavBuffering.push(buf);
                      continue;
                    }
                    if (!formatSent) {
                      if (mime.includes('pcm') || mime.includes('l16')) {
                        const rm = mime.match(/rate=(\d+)/); if (rm) knownRate = Number(rm[1]);
                        const cm = mime.match(/channels=(\d+)/); if (cm) knownCh = Number(cm[1]);
                      }
                      ws.send(JSON.stringify({ type: 'format', sampleRate: knownRate || 24000, channels: knownCh || 1, sampleFormat: 's16le' }));
                      formatSent = true;
                    }
                    if (buf && buf.length) ws.send(buf);
                  }
                  if (wavBuffering && wavBuffering.length) {
                    const all = Buffer.concat(wavBuffering);
                    const { extractPcmFromWav } = require('./ttsProcess.cjs');
                    const parsed = extractPcmFromWav(all);
                    if (parsed) {
                      if (!formatSent) {
                        ws.send(JSON.stringify({ type: 'format', sampleRate: parsed.sampleRate, channels: parsed.channels, sampleFormat: 's16le' }));
                        formatSent = true;
                      }
                      const chunkSize = 8192;
                      for (let i = 0; i < parsed.pcm.length && !aborted; i += chunkSize) {
                        ws.send(parsed.pcm.subarray(i, i + chunkSize));
                      }
                    }
                  }
                  ws.send(JSON.stringify({ type: 'end' }));
                  return ws.close();
                } catch (e) {
                  // fallback to non-streaming synth then chunk
                }
              }

              try {
                const res = await synthChunkPCM(text, 0);
                const sr = Number(sampleRate) || res.sampleRate || 44100; const ch = res.channels || 1;
                ws.send(JSON.stringify({ type: 'format', sampleRate: sr, channels: ch, sampleFormat: 's16le' }));
                const buf = res.buffer;
                const chunkSize = 8192;
                for (let i = 0; i < buf.length && !aborted; i += chunkSize) {
                  ws.send(buf.subarray(i, i + chunkSize));
                }
                ws.send(JSON.stringify({ type: 'end' }));
                ws.close();
              } catch (e) {
                try { ws.send(JSON.stringify({ type: 'error', message: e.message || String(e) })); } catch {}
                ws.close();
              }
            } catch (e) {
              try { ws.send(JSON.stringify({ type: 'error', message: e.message || String(e) })); } catch {}
              ws.close();
            }
          });
        });
      } catch (e) {
        console.warn('WebSocket setup failed', e && e.message ? e.message : e);
      }
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
