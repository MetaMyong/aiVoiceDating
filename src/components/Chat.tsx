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
  const [isStreamingOrTTS, setIsStreamingOrTTS] = useState(false); // Track if streaming or TTS is active
  const [currentTypingSentence, setCurrentTypingSentence] = useState(''); // Currently typing sentence
  const [completedSentencesForDisplay, setCompletedSentencesForDisplay] = useState<string[]>([]); // Completed sentences
  const [ttsActiveMessageIndex, setTtsActiveMessageIndex] = useState<number | null>(null); // Index of message being TTS'd
  // Typing animation lead time to run slightly faster than TTS (in ms)
  const TYPING_LEAD_MS = 500;
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    messageIndex: number;
  } | null>(null);
  
  // Edit mode state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // VAD/WebAudio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const voiceStartAtRef = useRef<number | null>(null);
  const silenceStartAtRef = useRef<number | null>(null);
  const utteranceStartAtRef = useRef<number | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const vadEnabledRef = useRef<boolean>(false);

  // VAD tuning
  const VAD_THRESHOLD = 0.015; // RMS threshold
  const VOICE_START_MS = 150;   // min voice before starting utterance
  const SILENCE_MS = 800;       // silence to end utterance
  const MAX_UTTERANCE_MS = 15000; // safety cap
  const MIN_BLOB_BYTES = 8000;  // ignore if recorded payload too small
  const MIN_TEXT_CHARS = 2;     // ignore too short transcripts
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // TTS: preserve strict order using sequence numbers
  interface TTSItem { seq: number; ready: boolean; url: string; text: string }
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

  // Enqueue text for TTS with strict order guarantee and display sync
  function enqueueTTSOrdered(text: string) {
    const seq = ttsSeqRef.current++;
    const item: TTSItem = { seq, ready: false, url: '', text };
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

  // Animate typing effect for current sentence
  function animateTyping(text: string, duration: number, onComplete?: () => void): NodeJS.Timeout {
    const chars = text.split('');
    const interval = Math.max(20, duration / chars.length); // At least 20ms per char
    let currentIndex = 0;
    
    // Start with empty, then incrementally build up
    setCurrentTypingSentence('');
    
    const timer = setInterval(() => {
      currentIndex++;
      if (currentIndex <= chars.length) {
        setCurrentTypingSentence(text.substring(0, currentIndex));
      }
      
      if (currentIndex >= chars.length) {
        clearInterval(timer);
        if (onComplete) onComplete();
      }
    }, interval);
    
    return timer;
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
      
      // Move to completed without animation
      const sentenceToComplete = nextItem.text;
      if (sentenceToComplete) {
        setCompletedSentencesForDisplay(prev => [...prev, sentenceToComplete]);
      }
      
      // try subsequent one
      return void attemptPlayNextOrdered();
    }

    ttsPlayingRef.current = true;
    const audioUrl = nextItem.url;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    // Helper: apply sink before playing for reliability
    const applySinkThenPlay = async () => {
      try {
        const settings = await getSettings();
        const sinkId = (settings as any)?.selectedOutputId;
        if (sinkId && typeof (audio as any).setSinkId === 'function') {
          await (audio as any).setSinkId(sinkId);
        }
      } catch (_) { /* ignore sink errors */ }
      try {
        await audio.play();
        console.log('[Chat] TTS playing:', currentSentence);
      } catch (e) {
        console.error('[Chat] Audio play error:', e);
        // Clean up on error
        if (typingTimer) clearInterval(typingTimer);
        ttsPlayingRef.current = false;
        ttsQueueRef.current = ttsQueueRef.current.filter(i => i !== nextItem);
        ttsNextSeqToPlayRef.current = nextSeq + 1;
        setCurrentTypingSentence('');
        // Immediately attempt to play next to avoid any visual gap
        attemptPlayNextOrdered();
      }
    };
    
    // Get the sentence for this sequence
    const currentSentence = nextItem.text || '';
    let typingTimer: NodeJS.Timeout | null = null;
    
    // Clear previous typing animation
    setCurrentTypingSentence('');
    if (nextSeq === 0) {
      // First TTS sentence - clear streaming text now
      setStreamingText('');
    }
    
    // Start typing animation IMMEDIATELY with estimated duration
    const baselineEstimated = Math.max(2000, currentSentence.length * 50); // 50ms per char estimate
    const estimatedDuration = Math.max(300, baselineEstimated - TYPING_LEAD_MS);
    console.log('[Chat] Starting typing animation immediately:', { 
      sentence: currentSentence, 
      estimatedDuration,
      baselineEstimated,
      leadMs: TYPING_LEAD_MS,
      chars: currentSentence.length 
    });
    
    typingTimer = animateTyping(currentSentence, estimatedDuration, () => {
      console.log('[Chat] Typing animation completed for sentence:', currentSentence);
    });
    
    // Update typing speed when audio metadata is loaded (to get accurate duration)
    const updateTypingSpeed = () => {
      const audioMs = audio.duration > 0 ? audio.duration * 1000 : estimatedDuration + TYPING_LEAD_MS;
      const adjustedDuration = Math.max(300, audioMs - TYPING_LEAD_MS);
      console.log('[Chat] Audio metadata loaded, updating typing speed:', { 
        audioMs,
        adjustedDuration,
        estimatedDuration,
        leadMs: TYPING_LEAD_MS,
        differenceFromEstimated: adjustedDuration - estimatedDuration
      });
      
      // Only restart if there's significant difference (more than 300ms)
      if (Math.abs(adjustedDuration - estimatedDuration) > 300 && typingTimer) {
        clearInterval(typingTimer);
        typingTimer = animateTyping(currentSentence, adjustedDuration, () => {
          console.log('[Chat] Typing animation completed for sentence:', currentSentence);
        });
      }
    };
    
    // Listen for metadata loaded event to adjust speed
    if (audio.readyState >= 1) {
      // Metadata already loaded
      updateTypingSpeed();
    } else {
      audio.addEventListener('loadedmetadata', updateTypingSpeed, { once: true });
    }
    
    // Apply sink (if any) and then play
    applySinkThenPlay();
    
    audio.onended = () => {
      console.log('[Chat] TTS ended:', currentSentence);
      console.log('[Chat] Current state:', {
        completedCount: completedSentencesForDisplay.length,
        queueLength: ttsQueueRef.current.length,
        nextSeq: ttsNextSeqToPlayRef.current + 1
      });
      
      if (typingTimer) clearInterval(typingTimer);
      URL.revokeObjectURL(audioUrl);
      audioRef.current = null;
      ttsPlayingRef.current = false;
      
      // remove the played item and advance sequence
      ttsQueueRef.current = ttsQueueRef.current.filter(i => i !== nextItem);
      ttsNextSeqToPlayRef.current = nextSeq + 1;
      
      // Check if all TTS is done
      if (ttsQueueRef.current.length === 0) {
        console.log('[Chat] All TTS completed');
        setIsStreamingOrTTS(false); // All TTS completed
        setTtsActiveMessageIndex(null); // Clear active TTS message to show full text normally
        setCompletedSentencesForDisplay([]); // Reset for next message
        setCurrentTypingSentence('');
      } else {
        // Move current typing sentence to completed list ONLY if more TTS to play
        setCompletedSentencesForDisplay(prev => {
          const updated = [...prev, currentSentence];
          console.log('[Chat] Updated completed sentences:', updated);
          return updated;
        });
        setCurrentTypingSentence('');
      }
      
  // Immediately attempt to play next to avoid any visual gap
  attemptPlayNextOrdered();
    };
  }

  // Delete message
  async function deleteMessage(index: number) {
    const updatedMessages = messages.filter((_, i) => i !== index);
    setMessages(updatedMessages);
    await saveConversationHistory('default', updatedMessages);
    setContextMenu(null);
  }

  // Start editing message
  function startEditMessage(index: number) {
    setEditingIndex(index);
    setEditText(messages[index].text);
    setContextMenu(null);
  }

  // Save edited message
  async function saveEditMessage() {
    if (editingIndex === null) return;
    
    const updatedMessages = [...messages];
    updatedMessages[editingIndex] = {
      ...updatedMessages[editingIndex],
      text: editText
    };
    
    setMessages(updatedMessages);
    await saveConversationHistory('default', updatedMessages);
    setEditingIndex(null);
    setEditText('');
  }

  // Cancel editing
  function cancelEdit() {
    setEditingIndex(null);
    setEditText('');
  }

  // Handle context menu (right-click or long-press)
  function handleContextMenu(e: React.MouseEvent, index: number) {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageIndex: index
    });
  }

  // Handle long-press for mobile
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  function handleTouchStart(e: React.TouchEvent, index: number) {
    longPressTimerRef.current = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({
        visible: true,
        x: touch.clientX,
        y: touch.clientY,
        messageIndex: index
      });
    }, 500); // 500ms long press
  }

  function handleTouchEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // Close context menu when clicking outside
  useEffect(() => {
    function handleClickOutside() {
      setContextMenu(null);
    }
    
    if (contextMenu?.visible) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

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
    setIsStreamingOrTTS(true); // Start streaming/TTS session
    
    // Reset TTS-related state immediately for new message
    setTtsActiveMessageIndex(null); // DON'T set to message index yet - wait for TTS to start
    setCompletedSentencesForDisplay([]);
    setCurrentTypingSentence('');

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
      const completedSentences: string[] = [];

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
                // DON'T show streaming text on screen - keep it hidden
                // setStreamingText(accumulatedText); // REMOVED
                console.log('[Chat] Stream chunk:', text);

                // Buffer into sentences and enqueue complete ones
                sentenceBuffer += text;
                const { sentences, remainder } = splitIntoSentencesIncremental(sentenceBuffer);
                sentenceBuffer = remainder;
                for (const s of sentences) {
                  completedSentences.push(s);
                  enqueueTTSOrdered(s);
                }
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
        completedSentences.push(sentenceBuffer.trim());
        enqueueTTSOrdered(sentenceBuffer.trim());
      }

      console.log('[Chat] Full streamed text:', accumulatedText);

      // Streaming is done - save to messages but DON'T display yet
      setIsLoading(false);
      setStreamingText('');
      
      const assistantMessage: Message = {
        role: 'assistant',
        text: accumulatedText,
        timestamp: new Date().toISOString()
      };

      // Save message but DON'T add to UI yet - wait for TTS to start
      // Store in a ref so TTS can access it
      const updatedMessages = [...newMessages, assistantMessage];
      
      // Save conversation history (but don't show in UI yet)
      await saveConversationHistory('default', updatedMessages);
      console.log('[Chat] Conversation saved, waiting for TTS to start before showing message');

      // Messages will be added when first TTS starts playing
      // Store the message index for later
      const pendingMessageIndex = updatedMessages.length - 1;
      
      // Wait a bit for first TTS to be ready
      const checkTTSReady = setInterval(() => {
        if (ttsQueueRef.current.length > 0 && ttsQueueRef.current[0].ready) {
          clearInterval(checkTTSReady);
          // First TTS is ready, now add message to UI
          setMessages(updatedMessages);
          setTtsActiveMessageIndex(pendingMessageIndex);
          console.log('[Chat] First TTS ready, showing message with index:', pendingMessageIndex);
        }
      }, 50);
      
      // Timeout after 10 seconds (increased from 5) - but NEVER clear TTS index if TTS is active
      setTimeout(() => {
        clearInterval(checkTTSReady);
        // Force show message even if TTS not ready
        if (messages.length < updatedMessages.length) {
          setMessages(updatedMessages);
          // ALWAYS keep TTS active if queue has items
          if (ttsQueueRef.current.length > 0 || ttsPlayingRef.current) {
            setTtsActiveMessageIndex(pendingMessageIndex);
            console.log('[Chat] Timeout but TTS active, keeping index:', pendingMessageIndex);
          } else {
            // Only clear if truly no TTS happening
            setTtsActiveMessageIndex(null);
            console.log('[Chat] Timeout and no TTS, clearing index');
          }
        }
      }, 10000);

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
      setIsStreamingOrTTS(false);
      setIsLoading(false);
    }
  }

  // Start a new utterance recording
  function startUtteranceRecording() {
    if (!streamRef.current || isRecordingRef.current) return;
    audioChunksRef.current = [];
    const rec = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm' });
    mediaRecorderRef.current = rec;
    isRecordingRef.current = true;
    utteranceStartAtRef.current = performance.now();

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      try {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const size = audioBlob.size || 0;
        console.log('[Chat] Utterance recorded. size=', size);
        // Ignore too small payloads
        if (size < MIN_BLOB_BYTES) {
          console.log('[Chat] Ignoring small utterance');
          return;
        }
        // Send to STT
        const settings = await getSettings();
        const formData = new FormData();
        formData.append('audio', audioBlob);
        if (settings?.googleServiceKey) formData.append('googleServiceKey', settings.googleServiceKey);
        const resp = await fetch('/api/stt/transcribe', { method: 'POST', body: formData });
        if (resp.ok) {
          const data = await resp.json();
          let transcribedText: string = data.text || '';
          if (transcribedText) transcribedText = transcribedText.trim();
          console.log('[Chat] Transcribed text:', transcribedText);
          const isTooShort = !transcribedText || transcribedText.replace(/[\s\p{P}\p{S}]/gu, '').length < MIN_TEXT_CHARS;
          if (!isTooShort && transcribedText) {
            await sendMessage(transcribedText);
          } else {
            console.log('[Chat] Ignoring empty/too short transcript');
          }
        } else {
          console.error('[Chat] STT error:', resp.status);
        }
      } catch (err) {
        console.error('[Chat] STT processing error:', err);
      }
    };
    rec.start();
    console.log('[Chat] Utterance recording started');
  }

  // Stop current utterance recording
  function stopUtteranceRecording() {
    if (!isRecordingRef.current) return;
    try {
      mediaRecorderRef.current?.stop();
    } catch (e) {
      console.warn('[Chat] Error stopping utterance recorder', e);
    } finally {
      isRecordingRef.current = false;
      mediaRecorderRef.current = null;
      utteranceStartAtRef.current = null;
    }
  }

  function computeRms(analyser: AnalyserNode): number {
    const bufferLength = analyser.fftSize;
    const data = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (data[i] - 128) / 128; // -1..1
      sumSquares += v * v;
    }
    return Math.sqrt(sumSquares / bufferLength);
  }

  function startVAD(stream: MediaStream) {
    if (audioContextRef.current) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    audioContextRef.current = ctx;
    analyserRef.current = analyser;
    vadEnabledRef.current = true;
    voiceStartAtRef.current = null;
    silenceStartAtRef.current = null;
    utteranceStartAtRef.current = null;

    const loop = () => {
      if (!vadEnabledRef.current || !analyserRef.current) return;
      const now = performance.now();
      const rms = computeRms(analyserRef.current);
      const isLoud = rms >= VAD_THRESHOLD;

      if (!isRecordingRef.current) {
        // not recording - watch for sustained voice to start
        if (isLoud) {
          if (voiceStartAtRef.current == null) voiceStartAtRef.current = now;
          if (now - (voiceStartAtRef.current || 0) >= VOICE_START_MS) {
            startUtteranceRecording();
            silenceStartAtRef.current = null;
          }
        } else {
          voiceStartAtRef.current = null;
        }
      } else {
        // recording - watch for silence to end or max duration
        if (isLoud) {
          silenceStartAtRef.current = null;
        } else {
          if (silenceStartAtRef.current == null) silenceStartAtRef.current = now;
          if (now - (silenceStartAtRef.current || 0) >= SILENCE_MS) {
            stopUtteranceRecording();
          }
        }
        const startedAt = utteranceStartAtRef.current || now;
        if (now - startedAt >= MAX_UTTERANCE_MS) {
          console.log('[Chat] Max utterance duration reached');
          stopUtteranceRecording();
        }
      }

      vadRafRef.current = requestAnimationFrame(loop);
    };
    vadRafRef.current = requestAnimationFrame(loop);
  }

  function stopVAD() {
    vadEnabledRef.current = false;
    if (vadRafRef.current != null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    try { stopUtteranceRecording(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    try { audioContextRef.current?.close(); } catch {}
    analyserRef.current = null;
    audioContextRef.current = null;
    voiceStartAtRef.current = null;
    silenceStartAtRef.current = null;
    utteranceStartAtRef.current = null;
  }

  async function toggleMic(){
    if (!listening) {
      try {
        const settings = await getSettings();
        let constraints: MediaStreamConstraints = { audio: true };
        if ((settings as any)?.selectedInputId) {
          constraints = { audio: { deviceId: { exact: (settings as any).selectedInputId } as any } } as MediaStreamConstraints;
        }
        const s = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = s;
        startVAD(s);
        setListening(true);
        console.log('[Chat] Mic listening (VAD) started');
      } catch (e) {
        console.error('[Chat] Mic access denied', e);
      }
    } else {
      try {
        stopVAD();
        streamRef.current?.getTracks().forEach(t => t.stop());
      } catch (e) {
        console.error('[Chat] Error stopping mic/VAD', e);
      }
      streamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);
      console.log('[Chat] Mic listening stopped');
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

  // Note: typing view is only shown when this index matches

  return (
    <main className="chat min-h-[60vh] flex flex-col bg-gray-50">
      <div className="messages flex-1 p-4 overflow-auto space-y-3">
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            onContextMenu={(e) => handleContextMenu(e, idx)}
            onTouchStart={(e) => handleTouchStart(e, idx)}
            onTouchEnd={handleTouchEnd}
          >
            {editingIndex === idx ? (
              <div className="w-[90%] mx-auto bg-white rounded-lg shadow-md p-4 border-2 border-blue-400">
                <textarea
                  className="w-full p-3 border rounded resize-none"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  autoFocus
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={saveEditMessage}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    저장
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div 
                className={`max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-yellow-300 text-gray-900' 
                    : 'bg-white text-gray-900 border border-gray-200'
                }`}
              >
                <div className="whitespace-pre-wrap break-words">
                  {msg.role === 'assistant' && ttsActiveMessageIndex === idx ? (
                    <>
                      {completedSentencesForDisplay.length > 0 && completedSentencesForDisplay.join(' ')}
                      {completedSentencesForDisplay.length > 0 && currentTypingSentence && ' '}
                      {currentTypingSentence}
                      {!currentTypingSentence && completedSentencesForDisplay.length === 0 && '\u200B'}
                    </>
                  ) : (
                    msg.text
                  )}
                </div>
                <div className="text-xs opacity-60 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString('ko-KR', { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
        
        {/* DO NOT show streaming text - it should never appear on screen */}
        {/* streamingText display completely removed */}
        
        <div ref={messagesEndRef} />
      </div>
      
      {/* Context Menu */}
      {contextMenu?.visible && (
        <div
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50"
          style={{ 
            left: `${contextMenu.x}px`, 
            top: `${contextMenu.y}px`,
            minWidth: '140px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => startEditMessage(contextMenu.messageIndex)}
            className="w-full px-4 py-2 text-left hover:bg-gray-100 text-sm flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            편집
          </button>
          <button
            onClick={() => deleteMessage(contextMenu.messageIndex)}
            className="w-full px-4 py-2 text-left hover:bg-red-50 text-sm text-red-600 flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
            삭제
          </button>
        </div>
      )}
      
      <footer className="composer flex items-center gap-2 p-4 bg-white border-t">
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
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      </footer>
    </main>
  )
}
