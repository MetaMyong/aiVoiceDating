// llmModel.js - Gemini via @google/generative-ai if available, else fallback
const fs = require('fs');
const path = require('path');

// ANSI colors: green for LLM request/response prefixes
const COLOR_GREEN = '\x1b[32m';
const COLOR_RESET = '\x1b[0m';

function now() { return new Date().toISOString() + ' '; }

// Remove a leading tone directive like "Say cheerfully: ..." or "Flirtatiously: ..."
function stripToneDirective(s) {
  if (!s || typeof s !== 'string') return s;
  const t = s.trim();
  // match up to 40 chars before a colon, then the rest
  const m = t.match(/^\s*([^:]{1,40}):\s*(.*)$/s);
  if (m && m[2] && m[2].length > 0) {
    // Heuristic: only strip if the prefix is short (likely a directive) and does not contain sentence end
    const prefix = m[1];
    if (prefix.length <= 40) return m[2].trim();
  }
  return t;
}

// No on-disk config.json usage; prefer environment variables. CONFIG stays in-memory only.
let CONFIG = {};
function getGeminiKey() {
  return process.env.GEMINI_API_KEY || CONFIG.geminiApiKey || '';
}
function getModelName() {
  return String(process.env.GEMINI_MODEL || CONFIG.geminiModel || 'gemini-2.5-flash');
}

// System prompt to prepend before conversation history for all request paths
// NOTE: This fallback is DEPRECATED. Use 'system' type blocks in promptBlocks instead.
function getSystemPrompt() {
  return (process.env.SYSTEM_INSTRUCTION || CONFIG.systemInstruction) || "";
}

// In-memory conversation history (append-only). Each item: { role: 'user'|'assistant', text: string }
const CONVERSATION_HISTORY = [];

let genai = null;
let genaiStreamClient = null;
let lastInitKey = null;
function ensureClients() {
  const key = getGeminiKey();
  if (!key) { genai = null; genaiStreamClient = null; lastInitKey = null; return; }
  if (lastInitKey === key && (genai || genaiStreamClient)) return;
  lastInitKey = key;
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    genai = new GoogleGenerativeAI(key);
  } catch (e) {
    genai = null;
  }
  try {
    const { GoogleGenAI } = require('@google/genai');
    genaiStreamClient = new GoogleGenAI({ apiKey: key });
  } catch (e) {
    genaiStreamClient = null;
  }
}

// Helper: SSE streaming directly to Gemini REST endpoint using native fetch
// promptOrHistory may be a string (single prompt) or an array (conversation history)
async function* streamFromGeminiSSE(promptOrHistory) {
  const GEMINI_KEY = getGeminiKey();
  const MODEL_NAME = getModelName();
  const SYSTEM_PROMPT = getSystemPrompt();
  if (!GEMINI_KEY) {
    throw new Error('GEMINI_API_KEY not set for SSE streaming');
  }

  // Parse generation config from environment
  let generationConfig = {};
  try {
    const gcStr = process.env.GENERATION_CONFIG;
    if (gcStr) {
      generationConfig = JSON.parse(gcStr);
    }
  } catch (e) {
    console.warn('[LLM] Failed to parse GENERATION_CONFIG', e.message);
  }

  let jsonBody;
  if (Array.isArray(promptOrHistory)) {
    // Two supported array shapes:
    // 1) conversation history: [{ role: 'user'|'assistant', text, ts? }]
    // 2) explicit messages:    [{ role: 'system'|'user'|'assistant', content }]
    if (promptOrHistory.length && Object.prototype.hasOwnProperty.call(promptOrHistory[0], 'content')) {
      const incoming = promptOrHistory;
      const systemTexts = incoming.filter(m => m.role === 'system').map(m => String(m.content || '')).filter(Boolean);
      const contents = incoming.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [ { text: String(m.content || '') } ]
      }));
      jsonBody = {
        ...(systemTexts.length ? { systemInstruction: { parts: [ { text: systemTexts.join('\n') } ] } } : {}),
        contents,
        generationConfig
      };
    } else {
      jsonBody = {
        systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] },
        contents: [ { role: 'model', parts: [ { text: SYSTEM_PROMPT } ] } ].concat(
          promptOrHistory.map(entry => ({
            role: entry.role === 'assistant' ? 'model' : 'user',
            parts: [ { text: `[${entry.ts || new Date().toISOString()}] ${entry.text}` } ]
          }))
        ),
        generationConfig
      };
    }
  } else {
    const ts = new Date().toISOString();
    jsonBody = {
      systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] },
      contents: [ { role: 'model', parts: [ { text: SYSTEM_PROMPT } ] }, { role: 'user', parts: [ { text: `[${ts}] ${String(promptOrHistory)}` } ] } ],
      generationConfig
    };
  }

  try {
    let lastUser = '';
    if (Array.isArray(promptOrHistory)) {
      for (let i = promptOrHistory.length - 1; i >= 0; i--) {
        const it = promptOrHistory[i];
        if (!it) continue;
        if (Object.prototype.hasOwnProperty.call(it, 'content')) {
          if (it.role === 'user') { lastUser = it.content; break; }
        } else if (it.role === 'user') {
          lastUser = it.text; break;
        }
      }
    } else {
      lastUser = String(promptOrHistory || '');
    }
    console.log(`${now()}${COLOR_GREEN}[LLM][Info]${COLOR_RESET} SSE sending user:`, String(lastUser).replace(/\s+/g, ' '));
  } catch (e) {}

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`;
  let _fetch = (typeof fetch === 'function') ? fetch : null;
  if (!_fetch) {
    try { _fetch = require('node-fetch'); } catch (e) { /* leave null */ }
  }
  if (!_fetch) throw new Error('fetch not available in this runtime');

  const resp = await _fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(jsonBody)
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '[no body]');
    throw new Error(`SSE stream request failed: ${resp.status} ${txt}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const prefix = 'data: ';
      if (!line.startsWith(prefix)) continue;
      const jsonStr = line.slice(prefix.length);
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          yield text;
        }
      } catch (e) {
        console.error('Error parsing stream JSON:', e);
      }
    }
  }
}

async function getAiResponse(guildId, userText) {
  ensureClients();
  const GEMINI_KEY = getGeminiKey();
  const MODEL_NAME = getModelName();
  const SYSTEM_PROMPT = getSystemPrompt();
  if (GEMINI_KEY || genaiStreamClient) {
    try {
      let reply = '';
      for await (const chunk of generateContentStream(userText, guildId)) {
        if (chunk && String(chunk).trim()) {
          reply += (reply ? ' ' : '') + String(chunk).trim();
        }
      }
      return reply;
    } catch (e) {
      console.error('Streaming getAiResponse 실패, fallback 시도:', e && e.message ? e.message : e);
    }
  }

  if (genai) {
    try {
      const model = genai.getGenerativeModel({ model: MODEL_NAME, systemInstruction: SYSTEM_PROMPT });
      const chat = model.startChat({ history: [] });
      console.log(`${now()}${COLOR_GREEN}[LLM][Request]${COLOR_RESET}`, typeof chat === 'object' ? '[object Chat]' : String(chat));
      const result = await chat.sendMessage(userText);
      console.log(`${now()}${COLOR_GREEN}[LLM][Response]${COLOR_RESET}`, typeof result === 'object' ? '[object Response]' : String(result));
      const text = (result && result.response && typeof result.response.text === 'function') ? await result.response.text() : (result && result.text) || String(result || '');
      return text || '';
    } catch (e) {
      console.error('Gemini 라이브러리 호출 실패', e.message || e);
      return 'AI 응답 생성 중 오류가 발생했습니다.';
    }
  }

  return `AI 응답(자리표시자): ${userText}`;
}

async function* generateContentStream(promptOrMessages, convId) {
  ensureClients();
  const GEMINI_KEY = getGeminiKey();
  const MODEL_NAME = getModelName();
  const SYSTEM_PROMPT = getSystemPrompt();
  let userTs = new Date().toISOString();
  let displayInput = '';
  if (Array.isArray(promptOrMessages) && promptOrMessages.length && Object.prototype.hasOwnProperty.call(promptOrMessages[0], 'content')) {
    // client provided explicit messages
    displayInput = JSON.stringify(promptOrMessages);
  } else {
    displayInput = String(promptOrMessages || '');
  }
  try { console.log(`${now()}${COLOR_GREEN}[LLM][Request]${COLOR_RESET}`, `[${userTs}] ${displayInput}`); } catch(e) {}
  
  const LLM_SOURCE = GEMINI_KEY ? 'sse' : (genaiStreamClient ? 'stream' : 'fallback');
  try { console.log(`${now()}${COLOR_GREEN}[LLM][Source]${COLOR_RESET}`, LLM_SOURCE); } catch(e) {}
  
  if (process.env.REQUIRE_STREAMING === '1' && LLM_SOURCE === 'fallback') {
    throw new Error('Streaming LLM client required but not available (REQUIRE_STREAMING=1)');
  }
  
  const rawChunkMs = (CONFIG.llmChunkFlushMs ? Number(CONFIG.llmChunkFlushMs) : (process.env.LLM_CHUNK_FLUSH_MS ? Number(process.env.LLM_CHUNK_FLUSH_MS) : NaN));
  const CHUNK_FLUSH_MS = Number.isFinite(rawChunkMs) ? Math.max(25, rawChunkMs) : 25;
  
  let runtimeConfig = CONFIG;
  try { runtimeConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config.json'), 'utf-8') || '{}'); } catch(e) { /* keep in-memory CONFIG */ }
  const runtimeTts = (process.env.TTS_PROVIDER || runtimeConfig.ttsProvider || '').toString().toLowerCase();
  const preferGeminiTts = runtimeTts.includes('gemini');

  if (GEMINI_KEY) {
    try {
      let inputForSSE = null;
      if (Array.isArray(promptOrMessages) && promptOrMessages.length && Object.prototype.hasOwnProperty.call(promptOrMessages[0], 'content')) {
        // Client provided explicit messages array - pass it directly to SSE
        inputForSSE = promptOrMessages;
      } else {
        // legacy: use server-side conversation history
        const apiHistory = Array.isArray(CONVERSATION_HISTORY) ? CONVERSATION_HISTORY.slice() : [];
        try { CONVERSATION_HISTORY.push({ role: 'user', text: String(promptOrMessages), ts: userTs }); } catch (e) {}
        if (preferGeminiTts) {
          apiHistory.push({ role: 'user', text: 'Please output a single short tone directive at the very start of your reply followed by a colon, for example: "Say cheerfully:". After that, continue with the full assistant response on the following sentences. Keep the directive concise.' });
        }
        inputForSSE = apiHistory;
      }
      const sseStream = streamFromGeminiSSE(inputForSSE);
      let assistantAccum = '';
      
      // Stream chunks immediately without sentence buffering
      for await (const chunk of sseStream) {
        try { console.log(`${now()}${COLOR_GREEN}[LLM][ChunkRaw]${COLOR_RESET}`, typeof chunk === 'string' ? chunk : JSON.stringify(chunk)); } catch(e) {}
        const piece = String(chunk || '');
        if (!piece) continue;
        
        console.log(`${now()}${COLOR_GREEN}[LLM][Chunk]${COLOR_RESET}`, piece.replace(/\s+/g, ' '));
        
        // Yield chunk immediately - let client handle sentence splitting
        assistantAccum += piece;
        yield piece;
      }
      
      if (assistantAccum && assistantAccum.trim()) {
        try { CONVERSATION_HISTORY.push({ role: 'assistant', text: stripToneDirective(assistantAccum.trim()), ts: new Date().toISOString() }); } catch(e) {}
      }
      return;
    } catch (e) {
      console.warn('[LLM][Info] SSE stream failed, falling back to other sources', e && e.message ? e.message : e);
    }
  }

  if (!genaiStreamClient) {
    try {
      const { GoogleGenAI } = require('@google/genai');
      genaiStreamClient = new GoogleGenAI({ apiKey: GEMINI_KEY });
      console.log(`${COLOR_GREEN}[LLM][Info]${COLOR_RESET} Streaming client initialized`);
    } catch (e) {
      genaiStreamClient = null;
    }
  }

  if (genaiStreamClient) {
    let buffer = '';
    let flushTimer = null;
    function scheduleFlush() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        try {
          const partial = buffer.trim();
          if (partial) {
            console.log(`${now()}${COLOR_GREEN}[LLM][Response][partial]${COLOR_RESET}`, partial);
            buffer = '';
          }
        } catch (e) {}
      }, CHUNK_FLUSH_MS);
    }
    try {
      const contentsForApi = CONVERSATION_HISTORY.map(c => ({ role: c.role === 'assistant' ? 'model' : 'user', parts: [ { text: `[${c.ts || new Date().toISOString()}] ${c.text}` } ] }));
      const stream = await genaiStreamClient.models.generateContentStream({ model: MODEL_NAME, contents: contentsForApi, systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] } });
      let assistantAccum = '';
      let _timestampRemoved = false;
      for await (const chunk of stream) {
        try { console.log(`${now()}${COLOR_GREEN}[LLM][ChunkRaw]${COLOR_RESET}`, typeof chunk === 'string' ? chunk : JSON.stringify(chunk)); } catch(e) {}
        const piece = (chunk && (chunk.text || chunk.content || chunk)) || '';
        const text = String(piece);
        if (!text) continue;
        buffer += text;
        
        if (!_timestampRemoved) {
          if (buffer.startsWith('[')) {
            const closeIdx = buffer.indexOf(']');
            if (closeIdx === -1) {
              continue;
            }
            buffer = buffer.slice(closeIdx + 1).replace(/^\s+/, '');
            _timestampRemoved = true;
          } else {
            _timestampRemoved = true;
          }
        }
        console.log(`${now()}${COLOR_GREEN}[LLM][Chunk]${COLOR_RESET}`, text.replace(/\s+/g, ' '));
        scheduleFlush();

        while (true) {
          const m = buffer.match(/^([\s\S]*?[\.\!\?\n]+)\s*/);
          if (m && m[1]) {
            const sentence = m[1].trim();
            buffer = buffer.slice(m[0].length);
            const out = sentence.replace(/[`*_]{1,3}/g, '').trim();
            if (out) {
              if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
              const outTs = new Date().toISOString();
              const yielded = `[${outTs}] ${out}`;
              console.log(`${now()}${COLOR_GREEN}[LLM][Response]${COLOR_RESET}`, yielded);
              assistantAccum += (assistantAccum ? ' ' : '') + out;
              yield yielded;
            }
            continue;
          }
          break;
        }
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      const rest = buffer.trim();
      if (rest) {
        const out = rest.replace(/[`*_]{1,3}/g, '').trim();
        if (out) {
          const outTs = new Date().toISOString();
          const yielded = `[${outTs}] ${out}`;
          console.log(`${now()}${COLOR_GREEN}[LLM][Response]${COLOR_RESET}`, yielded);
          assistantAccum += (assistantAccum ? ' ' : '') + out;
          yield yielded;
        }
      }
      if (assistantAccum && assistantAccum.trim()) {
        try { CONVERSATION_HISTORY.push({ role: 'assistant', text: stripToneDirective(assistantAccum.trim()), ts: new Date().toISOString() }); } catch(e) {}
      }
      return;
    } finally {}
  }

  console.log(`${now()}${COLOR_GREEN}[LLM][Request]${COLOR_RESET}`, promptText);
  try {
    const aiReply = await getAiResponse(null, promptText);
    const replyText = String(aiReply || '').trim();
    const pieces = (replyText.match(/(.+?[\.\!\?\n]+|.+$)/g) || [replyText]);
    for (const p of pieces) {
      const out = p.replace(/[`*_]{1,3}/g, '').trim();
      if (!out) continue;
      console.log(`${now()}${COLOR_GREEN}[LLM][Response]${COLOR_RESET}`, out);
      yield out;
      await new Promise(r => setTimeout(r, 10));
    }
  } catch (e) {
    const pieces = promptText.match(/(.+?[\.\!\?\n]+|.+$)/g) || [promptText];
    for (const p of pieces) {
      const out = p.replace(/[`*_]{1,3}/g, '').trim();
      if (!out) continue;
      console.log(`${now()}${COLOR_GREEN}[LLM][Response][fallback]${COLOR_RESET}`, out);
      yield out;
      await new Promise(r => setTimeout(r, 10));
    }
  }
}

module.exports = { getAiResponse, generateContentStream };
