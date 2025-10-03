import React, { useState, useRef, useEffect } from 'react'
import { getSettings, getConversationHistory, saveConversationHistory } from '../lib/indexeddb'
import { buildPromptMessages, PromptBlock } from '../lib/promptBuilder'

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

// Incremental sentence splitter to buffer partial sentences across chunks
function splitIntoSentencesIncremental(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  const endPunctuations = new Set(['.', '!', '?', ',', '。', '！', '？', '…', '，', '、']);
  const closers = new Set(['”', '’', '"', '\'', ')', ']', '】', '』', '〉', '》']);
  let i = 0;
  let start = 0;
  const len = buffer.length;
  while (i < len) {
    const ch = buffer[i];
    if (endPunctuations.has(ch)) {
      // Avoid creating sentences that start with a comma or are comma-only due to chunk boundaries
      if (ch === ',') {
        const before = buffer.slice(start, i);
        const hasWord = /[A-Za-z0-9\uAC00-\uD7A3]/.test(before);
        if (!hasWord) { i++; continue; }
      }
      i++;
      // consume immediate closers/spaces
      while (i < len && (closers.has(buffer[i]) || /\s/.test(buffer[i]))) {
        i++;
      }
      const sentence = buffer.slice(start, i).trim();
      if (sentence) sentences.push(sentence);
      start = i;
    } else {
      i++;
    }
  }
  return { sentences, remainder: buffer.slice(start) };
}

export default function Chat(){
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // TTS: preserve strict order using sequence numbers
  interface TTSItem { seq: number; ready: boolean; url: string }
  const ttsQueueRef = useRef<TTSItem[]>([]);
  const ttsSeqRef = useRef(0); // sequence to assign to next item
  const ttsNextSeqToPlayRef = useRef(0); // next sequence expected to play
  const ttsPlayingRef = useRef(false);

  // Load conversation history on mount
  useEffect(() => {
    (async () => {
      try {
        const history = await getConversationHistory('default');
        if (history && Array.isArray(history)) {
          setMessages(history);
        }
      } catch (e) {
        console.error('[Chat] Failed to load conversation history', e);
      }
    })();
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Synthesize a TTS audio URL immediately (non-blocking playback)
  async function synthesizeTTS(text: string): Promise<string> {
    try {
      // Pre-process text: remove trailing punctuation to prevent TTS model from adding unwanted continuation
      const cleanedText = text.replace(/[,.!~?]+$/g, '').trim();
      if (!cleanedText) return '';

      const settings = await getSettings();
      const provider = settings?.ttsProvider || 'gemini';
      
      // Use correct API key and model based on provider
      let apiKey = '';
      let fishModelId = '';
      if (provider === 'fishaudio') {
        apiKey = settings?.fishAudioApiKey || '';
        fishModelId = settings?.fishAudioModelId || '';
      } else {
        apiKey = settings?.geminiApiKey || '';
      }
      
      const voice = settings?.geminiTtsVoiceName || 'Zephyr';
      const model = settings?.geminiTtsModel;

      console.log('[Chat] TTS request:', { provider, voice: provider === 'gemini' ? voice : undefined, fishModelId: provider === 'fishaudio' ? fishModelId : undefined, textLength: text.length });

      const requestBody: any = { 
        text: cleanedText, 
        provider, 
        apiKey
      };

      // Add provider-specific parameters
      if (provider === 'gemini') {
        requestBody.voice = voice;
        if (model) requestBody.model = model;
      } else if (provider === 'fishaudio') {
        requestBody.fishModelId = fishModelId;
      }

      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        return audioUrl;
      } else {
        console.error('[Chat] TTS error:', response.status);
        return '';
      }
    } catch (error) {
      console.error('[Chat] TTS playback error:', error);
      return '';
    }
  }

  // Enqueue text for TTS with strict order guarantee
  function enqueueTTSOrdered(text: string) {
    const seq = ttsSeqRef.current++;
    const item: TTSItem = { seq, ready: false, url: '' };
    ttsQueueRef.current.push(item);
    // Kick off synthesis asynchronously; when ready, attempt to play if it's next
    synthesizeTTS(text).then((url) => {
      item.url = url;
      item.ready = true;
      attemptPlayNextOrdered();
    }).catch(() => {
      // mark as ready but no URL, we'll skip but keep order
      item.url = '';
      item.ready = true;
      attemptPlayNextOrdered();
    });
  }

  // Attempt to play the next item strictly in order
  function attemptPlayNextOrdered(){
    if (ttsPlayingRef.current) return;
    const nextSeq = ttsNextSeqToPlayRef.current;
    const nextItem = ttsQueueRef.current.find(i => i.seq === nextSeq);
    if (!nextItem) return; // not enqueued yet
    if (!nextItem.ready) return; // wait until synthesized

    // If synthesis failed, skip but advance order
    if (!nextItem.url) {
      // remove the item and advance sequence
      ttsQueueRef.current = ttsQueueRef.current.filter(i => i !== nextItem);
      ttsNextSeqToPlayRef.current = nextSeq + 1;
      // try subsequent one
      return void attemptPlayNextOrdered();
    }

    ttsPlayingRef.current = true;
    const audioUrl = nextItem.url;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      audioRef.current = null;
      ttsPlayingRef.current = false;
      // remove the played item and advance sequence
      ttsQueueRef.current = ttsQueueRef.current.filter(i => i !== nextItem);
      ttsNextSeqToPlayRef.current = nextSeq + 1;
      setTimeout(() => attemptPlayNextOrdered(), 150);
    };
    audio.play().then(() => {
      console.log('[Chat] TTS playing');
    }).catch((e) => {
      console.error('[Chat] Audio play error:', e);
      // allow next; advance sequence even on play error
      ttsPlayingRef.current = false;
      ttsQueueRef.current = ttsQueueRef.current.filter(i => i !== nextItem);
      ttsNextSeqToPlayRef.current = nextSeq + 1;
      setTimeout(() => attemptPlayNextOrdered(), 150);
    });
  }

  // Send message to LLM
  async function sendMessage(text: string) {
    if (!text.trim()) return;

    const userMessage: Message = {
      role: 'user',
      text: text.trim(),
      timestamp: new Date().toISOString()
    };

    console.log('[Chat] User message:', userMessage);
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsLoading(true);
    setStreamingText('');

    try {
      // Get settings
      const settings = await getSettings();
      console.log('[Chat] Settings loaded:', settings);

      // Build prompt from blocks
      const promptBlocks: PromptBlock[] = settings?.promptBlocks || [
        { name: '시스템 프롬프트', type: 'pure', prompt: 'You are a helpful AI assistant.', role: 'user' },
        { name: '대화 이력', type: 'conversation', prompt: '', role: 'user' },
        { name: '사용자 입력', type: 'pure', prompt: '{{user_input}}', role: 'user' }
      ];

      // Build messages from blocks WITHOUT adding user message at end
      // (user input is already inserted via {{user_input}} placeholder)
      let builtMessages = buildPromptMessages(promptBlocks, messages);
      
      // Replace {{user_input}} placeholder with actual user input
      builtMessages = builtMessages.map(msg => ({
        ...msg,
        content: msg.content.replace(/\{\{user_input\}\}/g, text.trim())
      }));

      console.log('[Chat] Built messages for LLM:', builtMessages);

      // Prepare generation config from settings
      const generationConfig: any = {};
      if (settings?.maxContextSize) generationConfig.maxContextSize = settings.maxContextSize;
      if (settings?.maxOutputTokens) generationConfig.maxOutputTokens = settings.maxOutputTokens;
      if (settings?.thinkingEnabled !== false && settings?.thinkingTokens) {
        generationConfig.thinkingTokens = settings.thinkingTokens;
      }
      if (settings?.temperatureEnabled !== false && settings?.temperature != null) {
        generationConfig.temperature = settings.temperature;
      }
      if (settings?.topPEnabled !== false && settings?.topP != null) {
        generationConfig.topP = settings.topP;
      }

      // Use streaming API (always enabled)
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: builtMessages,
          model: settings?.geminiModel || 'gemini-2.5-flash',
          apiKey: settings?.geminiApiKey,
          generationConfig
        })
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status}`);
      }

      // Read SSE stream with TTS queue
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      // reset TTS ordered queue and sequence for a new response
      ttsQueueRef.current = [];
      ttsSeqRef.current = 0;
      ttsNextSeqToPlayRef.current = 0;
      let sentenceBuffer = '';

      if (reader) {
        let sseBuffer = '';
        let doneStreaming = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') { doneStreaming = true; break; }
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.text ?? parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                accumulatedText += text;
                setStreamingText(accumulatedText);
                console.log('[Chat] Stream chunk:', text);

                // Buffer into sentences and enqueue complete ones
                sentenceBuffer += text;
                const { sentences, remainder } = splitIntoSentencesIncremental(sentenceBuffer);
                sentenceBuffer = remainder;
                for (const s of sentences) enqueueTTSOrdered(s);
              }
            } catch {
              // ignore JSON parse errors for partial frames
            }
          }
          if (doneStreaming) break;
        }
      }

      // Flush any remaining buffered text as a final sentence
      if (sentenceBuffer.trim()) {
        enqueueTTSOrdered(sentenceBuffer.trim());
      }

      console.log('[Chat] Full streamed text:', accumulatedText);

      const assistantMessage: Message = {
        role: 'assistant',
        text: accumulatedText || 'No response',
        timestamp: new Date().toISOString()
      };

      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);
      setStreamingText('');
      
      // Save conversation history
      await saveConversationHistory('default', updatedMessages);
      console.log('[Chat] Conversation saved');

      // TTS already playing via queue, no need to call again here

    } catch (error) {
      console.error('[Chat] Error sending message:', error);
      const errorMessage: Message = {
        role: 'assistant',
        text: '죄송합니다. 오류가 발생했습니다.',
        timestamp: new Date().toISOString()
      };
      setMessages([...newMessages, errorMessage]);
      setStreamingText('');
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleMic(){
    if (!listening) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = s;
        audioChunksRef.current = [];
        
        const mediaRecorder = new MediaRecorder(s);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = async () => {
          console.log('[Chat] Recording stopped, processing audio...');
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Send to STT
          try {
            const settings = await getSettings();
            const formData = new FormData();
            formData.append('audio', audioBlob);
            formData.append('apiKey', settings?.geminiApiKey || '');

            const response = await fetch('/api/stt/transcribe', {
              method: 'POST',
              body: formData
            });

            if (response.ok) {
              const data = await response.json();
              const transcribedText = data.text || '';
              console.log('[Chat] Transcribed text:', transcribedText);
              
              if (transcribedText) {
                await sendMessage(transcribedText);
              }
            } else {
              console.error('[Chat] STT error:', response.status);
            }
          } catch (error) {
            console.error('[Chat] STT processing error:', error);
          }
        };

        mediaRecorder.start();
        setListening(true);
        console.log('[Chat] Recording started');
      } catch (e) {
        console.error('[Chat] Mic access denied', e);
      }
    } else {
      try {
        mediaRecorderRef.current?.stop();
        streamRef.current?.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.error('[Chat] Error stopping recording', e);
      }
      streamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);
      console.log('[Chat] Recording stopped by user');
    }
  }

  function handleSendClick() {
    sendMessage(inputText);
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }

  return (
    <main className="chat min-h-[60vh] flex flex-col">
      <div className="messages flex-1 p-4 overflow-auto">
        {messages.map((msg, idx) => (
          <div key={idx} className={`msg ${msg.role === 'user' ? 'user' : 'bot'}`}>
            {msg.text}
          </div>
        ))}
        {streamingText && (
          <div className="msg bot">
            {streamingText}
            <span className="animate-pulse ml-1">▋</span>
          </div>
        )}
        {isLoading && !streamingText && (
          <div className="msg bot">
            <span className="animate-pulse">응답 생성 중...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <footer className="composer flex items-center gap-2 p-4">
        <button onClick={toggleMic} aria-pressed={listening} title="Toggle microphone" className={`w-10 h-10 rounded-lg bg-white shadow-lg border flex items-center justify-center ${listening ? 'ring-2 ring-red-300' : ''}`}>
          {listening ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="10" height="10" rx="3" fill="currentColor" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4" /><rect x="10" y="11" width="4" height="6" rx="1" fill="currentColor" stroke="none" /></svg>
          )}
        </button>
        <input 
          className="flex-1 px-4 py-3 rounded-lg border bg-white" 
          placeholder="메시지를 입력하세요..." 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={isLoading}
          autoComplete="off"
        />
        <button 
          onClick={handleSendClick} 
          disabled={isLoading || !inputText.trim()}
          className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-lg disabled:opacity-50" 
          title="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      </footer>
    </main>
  )
}
