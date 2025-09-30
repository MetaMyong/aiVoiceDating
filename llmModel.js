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
const GEMINI_KEY = process.env.GEMINI_API_KEY || CONFIG.geminiApiKey;
const MODEL_NAME = String(process.env.GEMINI_MODEL || CONFIG.geminiModel || 'gemini-2.5-flash');

// System prompt to prepend before conversation history for all request paths
const SYSTEM_PROMPT = (process.env.SYSTEM_INSTRUCTION || CONFIG.systemInstruction) || "당신은 사용자의 여자친구입니다. 다정하고 사랑스러운 반말로 응답해주세요. 이모티콘이나 마크다운을 사용하지 말고, 1~2 문장의 짧은 한국어로 응답해주세요.";

// In-memory conversation history (append-only). Each item: { role: 'user'|'assistant', text: string }
const CONVERSATION_HISTORY = [];

// Conversation persistence moved to client-side IndexedDB. Server keeps in-memory CONVERSATION_HISTORY only.

// Conversation persistence helpers
const CONV_DIR = path.resolve(__dirname, 'conversations');
// The following functions are no longer needed and have been removed:
// function ensureConvDir() { ... }
// function loadConversation(convId) { ... }
// function saveConversation(convId, arr) { ... }

let genai = null;
let genaiStreamClient = null;
try {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  if (GEMINI_KEY) genai = new GoogleGenerativeAI(GEMINI_KEY);
} catch (e) {
  genai = null;
}
// Prefer @google/genai streaming client if available
try {
  const { GoogleGenAI } = require('@google/genai');
  genaiStreamClient = new GoogleGenAI({ apiKey: GEMINI_KEY });
} catch (e) {
  genaiStreamClient = null;
}

// Helper: SSE streaming directly to Gemini REST endpoint using native fetch
// promptOrHistory may be a string (single prompt) or an array (conversation history)
async function* streamFromGeminiSSE(promptOrHistory) {
  if (!GEMINI_KEY) {
    throw new Error('GEMINI_API_KEY not set for SSE streaming');
  }

  // Build request body expected by Generative Language SSE: use 'contents' with text parts
  // If your provider expects a different shape, adjust here. Keep this compact to avoid
  // "Unknown name" errors from the API.
  // Build contents as an array of Content objects (role + parts) to match
  // the REST API's GenerateContentRequest shape (each content has parts[] with text).
  // For a simple single-turn prompt we send one user content with one text part.
  // Build jsonBody from either a single prompt or a conversation history array
  let jsonBody;
  if (Array.isArray(promptOrHistory)) {
    // convert history entries into API 'contents' shape, map assistant->model
    // NOTE: do NOT prefix messages with timestamps when sending to API to avoid echoing timestamps
    jsonBody = {
      systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] },
      contents: [ { role: 'model', parts: [ { text: SYSTEM_PROMPT } ] } ].concat(
        promptOrHistory.map(entry => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [ { text: `[${entry.ts || new Date().toISOString()}] ${entry.text}` } ]
        }))
      )
    };
  } else {
    const ts = new Date().toISOString();
    jsonBody = {
      systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] },
      contents: [ { role: 'model', parts: [ { text: SYSTEM_PROMPT } ] }, { role: 'user', parts: [ { text: `[${ts}] ${String(promptOrHistory)}` } ] } ]
    };
  }
  // For logging brevity, only show the last user message being sent
  try {
    let lastUser = '';
    if (Array.isArray(promptOrHistory)) {
      for (let i = promptOrHistory.length - 1; i >= 0; i--) {
        if (promptOrHistory[i] && promptOrHistory[i].role === 'user') { lastUser = promptOrHistory[i].text; break; }
      }
    } else {
      lastUser = String(promptOrHistory || '');
    }
    console.log(`${now()}${COLOR_GREEN}[LLM][Info]${COLOR_RESET} SSE sending user:`, String(lastUser).replace(/\s+/g, ' '));
  } catch (e) {}

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:streamGenerateContent?key=${GEMINI_KEY}&alt=sse`;
  // prefer global fetch; fall back to node-fetch if available
  let _fetch = (typeof fetch === 'function') ? fetch : null;
  if (!_fetch) {
    try { _fetch = require('node-fetch'); } catch (e) { /* leave null */ }
  }
  if (!_fetch) throw new Error('fetch not available in this runtime');

  const resp = await _fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jsonBody) });
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
      const jsonStr = line.slice(prefix.length).trim();
      if (!jsonStr) continue;
      try {
        const parsed = JSON.parse(jsonStr);
        // try common shapes
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
                  || parsed?.output?.[0]?.content?.[0]?.text
                  || parsed?.delta?.content?.[0]?.text
                  || parsed?.text
                  || parsed?.message?.content?.text;
        if (text) {
          // yield raw text chunk (consumer will handle sentence splitting)
          buffer = (buffer || ''); // keep buffer
          yield String(text);
        }
      } catch (e) {
        console.warn('Failed to parse SSE JSON chunk', e.message || e);
      }
    }
  }
}

async function getAiResponse(guildId, userText) {
  // If a streaming path is available, use the streaming generator to build a full response.
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
      // fall through to non-streaming if possible
    }
  }

  // If the genai library (synchronous API) is available, use it as a non-streaming fallback.
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

  // Final fallback: simple echo-like response
  return `AI 응답(자리표시자): ${userText}`;
}

// Optional convId argument to persist conversation history to conversations/<convId>.json
async function* generateContentStream(promptText, convId) {
  // log the request prompt immediately (green prefix)
  // load persisted history if convId provided
  if (convId) {
    try {
      const loaded = loadConversation(convId);
      if (Array.isArray(loaded)) {
        CONVERSATION_HISTORY.length = 0;
        Array.prototype.push.apply(CONVERSATION_HISTORY, loaded);
      }
    } catch (e) {}
  }
  // record user message into conversation history (include ISO timestamp)
  let userTs = new Date().toISOString();
  try { CONVERSATION_HISTORY.push({ role: 'user', text: String(promptText), ts: userTs }); } catch (e) {}
  // log the request with timestamped user message
  try { console.log(`${now()}${COLOR_GREEN}[LLM][Request]${COLOR_RESET}`, `[${userTs}] ${String(promptText)}`); } catch(e) {}
  // Determine source: prefer SSE if GEMINI_KEY present, else genai stream client, else fallback
  const LLM_SOURCE = GEMINI_KEY ? 'sse' : (genaiStreamClient ? 'stream' : 'fallback');
  try { console.log(`${now()}${COLOR_GREEN}[LLM][Source]${COLOR_RESET}`, LLM_SOURCE); } catch(e) {}
  if (process.env.REQUIRE_STREAMING === '1' && LLM_SOURCE === 'fallback') {
    throw new Error('Streaming LLM client required but not available (REQUIRE_STREAMING=1)');
  }
  // central chunk flush setting (used by SSE path and genai stream path)
  // Default to a very small latency for fastest partial flushes; enforce a safe minimum of 25ms.
  const rawChunkMs = (CONFIG.llmChunkFlushMs ? Number(CONFIG.llmChunkFlushMs) : (process.env.LLM_CHUNK_FLUSH_MS ? Number(process.env.LLM_CHUNK_FLUSH_MS) : NaN));
  const CHUNK_FLUSH_MS = Number.isFinite(rawChunkMs) ? Math.max(25, rawChunkMs) : 25;
  
  // Reload config to detect runtime TTS provider preference
  let runtimeConfig = CONFIG;
  try { runtimeConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config.json'), 'utf-8') || '{}'); } catch(e) { /* keep in-memory CONFIG */ }
  const runtimeTts = (process.env.TTS_PROVIDER || runtimeConfig.ttsProvider || '').toString().toLowerCase();
  const preferGeminiTts = runtimeTts.includes('gemini');

  // If a Gemini API key is present, prefer native SSE streaming path
  if (GEMINI_KEY) {
    try {
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
              // yield partial synchronously by pushing through the generator below
              // (we'll handle by yielding when timer fires is not possible directly here)
            }
          } catch (e) {}
        }, CHUNK_FLUSH_MS);
      }

  // Build a temporary API history so we can inject a simple tone-instruction when Gemini TTS is used.
  const apiHistory = Array.isArray(CONVERSATION_HISTORY) ? CONVERSATION_HISTORY.slice() : [];
  if (preferGeminiTts) {
    // Do not persist this instruction; it's only for the LLM to emit a tone directive at the start of its reply.
    apiHistory.push({ role: 'user', text: 'Please output a single short tone directive at the very start of your reply followed by a colon, for example: "Say cheerfully:". After that, continue with the full assistant response on the following sentences. Keep the directive concise.' });
  }
  const sseStream = streamFromGeminiSSE(apiHistory);
  let assistantAccum = '';
      let _timestampRemoved = false;
      for await (const chunk of sseStream) {
        try { console.log(`${now()}${COLOR_GREEN}[LLM][ChunkRaw]${COLOR_RESET}`, typeof chunk === 'string' ? chunk : JSON.stringify(chunk)); } catch(e) {}
        const piece = String(chunk || '');
        if (!piece) continue;
        buffer += piece;
        // If we haven't yet removed a leading [ISO_TIMESTAMP] and the buffer starts with '[',
        // wait until we see the closing ']' and then strip the whole bracketed prefix once.
        if (!_timestampRemoved) {
          if (buffer.startsWith('[')) {
            const closeIdx = buffer.indexOf(']');
            if (closeIdx === -1) {
              // closing bracket not yet arrived; wait for more chunks
              continue;
            }
            // remove prefix including closing bracket and any following whitespace
            buffer = buffer.slice(closeIdx + 1).replace(/^\s+/, '');
            _timestampRemoved = true;
          } else {
            // no leading timestamp present
            _timestampRemoved = true;
          }
        }
        console.log(`${now()}${COLOR_GREEN}[LLM][Chunk]${COLOR_RESET}`, piece.replace(/\s+/g, ' '));
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
        if (convId) saveConversation(convId, CONVERSATION_HISTORY);
      }
      return;
    } catch (e) {
      console.warn('[LLM][Info] SSE stream failed, falling back to other sources', e && e.message ? e.message : e);
      // continue to try genaiStreamClient or fallback
    }
  }
  // If @google/genai streaming client is available, use it and parse into sentences
  // Try to lazily initialize streaming client if not set
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
  // build contents from in-memory conversation history (include timestamps in text)
  const contentsForApi = CONVERSATION_HISTORY.map(c => ({ role: c.role === 'assistant' ? 'model' : 'user', parts: [ { text: `[${c.ts || new Date().toISOString()}] ${c.text}` } ] }));
      const stream = await genaiStreamClient.models.generateContentStream({ model: MODEL_NAME, contents: contentsForApi, systemInstruction: { parts: [ { text: SYSTEM_PROMPT } ] } });
      let assistantAccum = '';
      let _timestampRemoved = false;
      for await (const chunk of stream) {
        // chunk may be an object with .text or plain string
        // log raw chunk for debugging (structure may vary)
        try { console.log(`${now()}${COLOR_GREEN}[LLM][ChunkRaw]${COLOR_RESET}`, typeof chunk === 'string' ? chunk : JSON.stringify(chunk)); } catch(e) {}
        const piece = (chunk && (chunk.text || chunk.content || chunk)) || '';
        const text = String(piece);
        if (!text) continue;
        // append and try to extract complete sentences
        buffer += text;
        // one-time leading [ISO_TS] removal to avoid breaking sentence boundaries across chunks
        if (!_timestampRemoved) {
          if (buffer.startsWith('[')) {
            const closeIdx = buffer.indexOf(']');
            if (closeIdx === -1) {
              // wait for more chunks until we have closing bracket
              continue;
            }
            buffer = buffer.slice(closeIdx + 1).replace(/^\s+/, '');
            _timestampRemoved = true;
          } else {
            _timestampRemoved = true;
          }
        }
        // log incoming chunk (LLM chunk)
        console.log(`${now()}${COLOR_GREEN}[LLM][Chunk]${COLOR_RESET}`, text.replace(/\s+/g, ' '));
        // reset partial-flush timer
        scheduleFlush();

        // extract sentences ending with . ! ? or newline
        while (true) {
          const m = buffer.match(/^([\s\S]*?[\.\!\?\n]+)\s*/);
          if (m && m[1]) {
            const sentence = m[1].trim();
            buffer = buffer.slice(m[0].length);
            const out = sentence.replace(/[`*_]{1,3}/g, '').trim();
            if (out) {
              // cancel scheduled partial flush for this extracted sentence
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
      // After stream ends, if any flushTimer pending, clear it
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      // stream ended; flush remainder
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
      // append assistant reply to history and persist
      if (assistantAccum && assistantAccum.trim()) {
        try { CONVERSATION_HISTORY.push({ role: 'assistant', text: stripToneDirective(assistantAccum.trim()), ts: new Date().toISOString() }); } catch(e) {}
        if (convId) saveConversation(convId, CONVERSATION_HISTORY);
      }
      return;
    } finally {}
  }

  // fallback: simple non-streaming split
  // fallback: no streaming client available — call the non-streaming LLM helper
  // Log the LLM request (prefix colored) and then call the non-streaming LLM.
  console.log(`${now()}${COLOR_GREEN}[LLM][Request]${COLOR_RESET}`, promptText);
  try {
    const aiReply = await getAiResponse(null, promptText);
    const replyText = String(aiReply || '').trim();
    const pieces = (replyText.match(/(.+?[\.\!\?\n]+|.+$)/g) || [replyText]);
    for (const p of pieces) {
      const out = p.replace(/[`*_]{1,3}/g, '').trim();
      if (!out) continue;
      // Log each sentence as a response chunk so users see per-sentence events
  console.log(`${now()}${COLOR_GREEN}[LLM][Response]${COLOR_RESET}`, out);
      // yield immediately so TTS can start synthesizing this sentence
      yield out;
      // small pause to avoid hammering TTS simultaneously
      await new Promise(r => setTimeout(r, 10));
    }
  } catch (e) {
    // As a last resort, fall back to echoing the original prompt (keeps behavior safe)
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
