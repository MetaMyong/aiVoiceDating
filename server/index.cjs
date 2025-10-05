// server/index.cjs - Express 기반의 통합 서버 (CommonJS)
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const multer = require('multer');
const { getAiResponse, generateContentStream } = require('./llmModel.cjs');
const { audioToText } = require('./sttProcess.cjs');
const { synthChunkSync } = require('./ttsProcess.cjs');

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

// TTS 엔드포인트
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

    // Synthesize
    const audioFilePath = await synthChunkSync(text, 0);
    
    if (!audioFilePath || !fs.existsSync(audioFilePath)) {
      throw new Error('TTS 생성 실패');
    }

    console.log('[API] TTS file generated:', audioFilePath);

    // Read file and send as response
    const audioData = fs.readFileSync(audioFilePath);
    const ext = path.extname(audioFilePath).toLowerCase();
    
    let contentType = 'audio/mpeg';
    if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.mp3') contentType = 'audio/mpeg';
    else if (ext === '.ogg') contentType = 'audio/ogg';

    res.setHeader('Content-Type', contentType);
    res.send(audioData);

    // Clean up temp file
    setTimeout(() => {
      try { fs.unlinkSync(audioFilePath); } catch (e) {}
    }, 1000);

  } catch (error) {
    console.error('[API] TTS error:', error);
    res.status(500).json({ 
      error: 'TTS 처리 실패',
      message: error.message 
    });
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
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
