import React, { useState, useRef, useEffect } from 'react'
import { getSettings, getConversationHistory, saveConversationHistory, getActiveChatRoom, getRoomAuthorNotes } from '../lib/indexeddb'
import { buildPromptMessages, PromptBlock } from '../lib/promptBuilder'

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

// Regex script type used in settings and optional card extensions
type RegexScript = {
  id?: string;
  name?: string;
  type?: 'request' | 'display' | 'input' | 'output' | 'disabled';
  in: string;
  out: string;
  flags?: string;
  enabled?: boolean;
};

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
  const [activeRoomId, setActiveRoomId] = useState<string>('default'); // Active chat room ID
  // Persona/Regex
  const [regexScripts, setRegexScripts] = useState<RegexScript[]>([]);
  const [personaCard, setPersonaCard] = useState<any>(null);
  const [assetMap, setAssetMap] = useState<Record<string,string>>({});
  const [roomAuthorNotes, setRoomAuthorNotes] = useState<string>('');
  // Typing animation lead time to run slightly faster than TTS (in ms)
  const TYPING_LEAD_MS = 500;
  // Keep latest active room id for event handlers
  const activeRoomIdRef = useRef<string>('default');
  
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
  
  // Persona TTS state
  const [personaTTS, setPersonaTTS] = useState<{provider: string, model: string, voice?: string} | null>(null);
  const personaTTSPlayingRef = useRef(false);
  const personaTTSScheduledRef = useRef(false); // 페르소나 TTS가 예정되어 있는지
  
  // Character TTS state (캐릭터별 TTS)
  const [characterTTS, setCharacterTTS] = useState<{provider: string, model: string, voice?: string} | null>(null);
  
  const pendingLLMResponseRef = useRef<{messages: Message[], index: number} | null>(null);

  // Load conversation history on mount
  useEffect(() => {
    (async () => {
      let onRoomChangeFn: any = null;
      let onAuthorNotesChangedFn: any = null;
      try {
        // Listen for chat room changes
        onRoomChangeFn = async (e: any) => {
          const roomId = e.detail?.roomId || 'default'
          setActiveRoomId(roomId)
          activeRoomIdRef.current = roomId
          const history = await getConversationHistory(roomId)
          if (history && Array.isArray(history)) {
            setMessages(history)
          } else {
            setMessages([])
          }
          try { const an = await getRoomAuthorNotes(roomId); setRoomAuthorNotes(an || '') } catch {}
        }
        window.addEventListener('chatRoomChanged', onRoomChangeFn as any)
        onAuthorNotesChangedFn = (e: any) => {
          const rid = e.detail?.roomId
          const notes = e.detail?.notes
          if (!rid || rid !== (activeRoomIdRef.current || 'default')) return
          if (typeof notes === 'string') setRoomAuthorNotes(notes)
        }
        window.addEventListener('authorNotesChanged', onAuthorNotesChangedFn as any)
        
    // Load initial room or default
  const cfg = await getSettings()
  const selectedCardIdx = cfg?.selectedCharacterCardIndex
        let roomId = 'default'
        if (typeof selectedCardIdx === 'number') {
          const activeRoom = await getActiveChatRoom(selectedCardIdx)
          if (activeRoom) roomId = activeRoom
        }
        setActiveRoomId(roomId)
        activeRoomIdRef.current = roomId
        const history = await getConversationHistory(roomId)
        if (history && Array.isArray(history)) {
          setMessages(history)
        }
        try { const an = await getRoomAuthorNotes(roomId); setRoomAuthorNotes(an || '') } catch {}
        const s = await getSettings();
        
        // Load persona TTS settings (사용자 음성)
        const idx = s?.selectedPersonaIndex ?? 0;
        const personas = s?.personas || [];
        const persona = personas[idx];
        if (persona?.ttsProvider && persona.ttsProvider !== 'none') {
          setPersonaTTS({
            provider: persona.ttsProvider,
            model: persona.ttsModel || '',
            voice: persona.ttsVoice
          });
        } else {
          setPersonaTTS(null);
        }
        
        // Load character card (AI 캐릭터)
        let card = null;
        if (typeof selectedCardIdx === 'number' && Array.isArray(s?.characterCards)) {
          const cardItem = s.characterCards[selectedCardIdx];
          card = cardItem?.card || null;
        }
        setPersonaCard(card);
        
        // Load character TTS settings from card (AI 음성)
        const charTTSConfig = card?.data?.extensions?.characterTTS;
        console.log('[Chat] Loading character TTS from card:', charTTSConfig);
        if (charTTSConfig?.provider && charTTSConfig.provider !== 'none') {
          setCharacterTTS({
            provider: charTTSConfig.provider,
            model: charTTSConfig.model || '',
            voice: charTTSConfig.voice
          });
          console.log('[Chat] Character TTS configured:', { provider: charTTSConfig.provider, model: charTTSConfig.model });
        } else {
          setCharacterTTS(null);
          console.log('[Chat] Character TTS not configured');
        }
        // Prefer settings-defined regexScripts; fallback to card customScripts
        const cfgScripts = Array.isArray(s?.regexScripts) ? s.regexScripts : [];
        let normalized: RegexScript[] = cfgScripts
          .map((r: any): RegexScript => ({ id:r.id, name:r.name, type:r.type||'request', in:String(r.in||''), out:String(r.out||''), flags:r.flags||'g', enabled: r.enabled!==false }))
          .filter((r: RegexScript) => r.in && (r.out!==undefined));
        if (!normalized.length) {
          const rs = card?.data?.extensions?.risuai?.customScripts || [];
          normalized = Array.isArray(rs)
            ? rs
                .map((r: any): RegexScript => ({
                  id: r.id,
                  name: r.name || r.title || '',
                  type: (r.type === 'input' || r.type === 'output' || r.type === 'request' || r.type === 'display' || r.type === 'disabled') ? r.type : 'display',
                  in: r.in || r.regex_in || '',
                  out: r.out || r.regex_out || '',
                  flags: r.flags || 'g',
                  enabled: r.enabled !== false
                }))
                .filter((r: RegexScript) => r.in && (r.out!==undefined))
            : [];
        }
        setRegexScripts(normalized);
        // Build asset name -> uri map
        const amap: Record<string,string> = {};
        const assets = card?.data?.assets || [];
        if (Array.isArray(assets)) {
          for (const a of assets) {
            if (a?.name && a?.uri) {
              amap[String(a.name)] = String(a.uri);
            }
          }
        }
        // Also support Risu v2-like additionalAssets [[name,uri,ext]]
        const extAssets = card?.data?.extensions?.risuai?.additionalAssets || [];
        if (Array.isArray(extAssets)) {
          for (const ea of extAssets) {
            if (ea && ea.length >= 2) {
              const nm = ea[0];
              const uri = ea[1];
              amap[String(nm)] = String(uri);
            }
          }
        }
        setAssetMap(amap);
      } catch (e) {
        console.error('[Chat] Failed to load conversation history', e);
      }
      return () => {
        try { if (onRoomChangeFn) window.removeEventListener('chatRoomChanged', onRoomChangeFn as any) } catch {}
        try { if (onAuthorNotesChangedFn) window.removeEventListener('authorNotesChanged', onAuthorNotesChangedFn as any) } catch {}
      }
    })();
  }, []);

  // Reload character TTS when character card is updated
  useEffect(() => {
    const reloadFromCard = async () => {
      try {
        const s = await getSettings();
        const selectedCardIdx = s?.selectedCharacterCardIndex;
        let card = null;
        if (typeof selectedCardIdx === 'number' && Array.isArray(s?.characterCards)) {
          const cardItem = s.characterCards[selectedCardIdx];
          card = cardItem?.card || null;
        }
        
        const charTTSConfig = card?.data?.extensions?.characterTTS;
        console.log('[Chat] Reloading character TTS from card:', charTTSConfig);
        if (charTTSConfig?.provider && charTTSConfig.provider !== 'none') {
          setCharacterTTS({
            provider: charTTSConfig.provider,
            model: charTTSConfig.model || '',
            voice: charTTSConfig.voice
          });
          console.log('[Chat] Character TTS updated:', { provider: charTTSConfig.provider, model: charTTSConfig.model, voice: charTTSConfig.voice });
        } else {
          setCharacterTTS(null);
          console.log('[Chat] Character TTS cleared');
        }

        // Also reload regex scripts and assets immediately so they take effect without refresh
        const cfgScripts = Array.isArray(s?.regexScripts) ? s.regexScripts : [];
        let normalized: RegexScript[] = cfgScripts
          .map((r: any): RegexScript => ({ id:r.id, name:r.name, type:r.type||'request', in:String(r.in||''), out:String(r.out||''), flags:r.flags||'g', enabled: r.enabled!==false }))
          .filter((r: RegexScript) => r.in && (r.out!==undefined));
        if (!normalized.length) {
          const rs = card?.data?.extensions?.risuai?.customScripts || [];
          normalized = Array.isArray(rs)
            ? rs
                .map((r: any): RegexScript => ({
                  id: r.id,
                  name: r.name || r.title || '',
                  type: (r.type === 'input' || r.type === 'output' || r.type === 'request' || r.type === 'display' || r.type === 'disabled') ? r.type : 'display',
                  in: r.in || r.regex_in || '',
                  out: r.out || r.regex_out || '',
                  flags: r.flags || 'g',
                  enabled: r.enabled !== false
                }))
                .filter((r: RegexScript) => r.in && (r.out!==undefined))
            : [];
        }
        setRegexScripts(normalized);

        const amap: Record<string,string> = {};
        const assets = card?.data?.assets || [];
        if (Array.isArray(assets)) {
          for (const a of assets) {
            if (a?.name && a?.uri) {
              amap[String(a.name)] = String(a.uri);
            }
          }
        }
        const extAssets = card?.data?.extensions?.risuai?.additionalAssets || [];
        if (Array.isArray(extAssets)) {
          for (const ea of extAssets) {
            if (ea && ea.length >= 2) {
              const nm = ea[0];
              const uri = ea[1];
              amap[String(nm)] = String(uri);
            }
          }
        }
        setAssetMap(amap);
      } catch (e) {
        console.error('[Chat] Failed to reload character TTS', e);
      }
    };
    
    window.addEventListener('characterCardsUpdate', reloadFromCard as any);
    return () => {
      window.removeEventListener('characterCardsUpdate', reloadFromCard as any);
    };
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Synthesize persona TTS (for user input)
  async function synthesizePersonaTTS(text: string): Promise<string> {
    try {
      if (!personaTTS || !text.trim()) return '';

      const cleanedText = text.replace(/[,.!~?]+$/g, '').trim();
      if (!cleanedText) return '';

      const settings = await getSettings();
      const requestBody: any = { 
        text: cleanedText, 
        provider: personaTTS.provider,
        apiKey: personaTTS.provider === 'gemini' ? settings?.geminiApiKey : settings?.fishAudioApiKey
      };

      if (personaTTS.provider === 'gemini') {
        requestBody.voice = personaTTS.voice || 'Zephyr';
        if (personaTTS.model) requestBody.model = personaTTS.model;
      } else if (personaTTS.provider === 'fishaudio') {
        requestBody.fishModelId = personaTTS.model;
      }

      console.log('[Chat] Persona TTS request:', requestBody);

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
        console.error('[Chat] Persona TTS error:', response.status);
        return '';
      }
    } catch (error) {
      console.error('[Chat] Persona TTS error:', error);
      return '';
    }
  }

  // Synthesize a TTS audio URL immediately (non-blocking playback)
  async function synthesizeTTS(text: string): Promise<string> {
    try {
      // 캐릭터 TTS가 설정되어 있으면 사용안함 옵션을 선택한 경우 TTS 사용하지 않음
      if (!characterTTS) {
        console.log('[Chat] Character TTS not configured, skipping TTS');
        return '';
      }
      
      // Pre-process text: remove trailing punctuation to prevent TTS model from adding unwanted continuation
      const cleanedText = text.replace(/[,.!~?]+$/g, '').trim();
      if (!cleanedText) return '';

      const settings = await getSettings();
      const provider = characterTTS.provider;
      
      // Use correct API key and model based on provider
      let apiKey = '';
      let fishModelId = '';
      if (provider === 'fishaudio') {
        apiKey = settings?.fishAudioApiKey || '';
        fishModelId = characterTTS.model || '';
      } else {
        apiKey = settings?.geminiApiKey || '';
      }
      
      const voice = characterTTS.voice || 'Zephyr';
      const model = characterTTS.model;

      console.log('[Chat] Character TTS request:', { provider, voice: provider === 'gemini' ? voice : undefined, fishModelId: provider === 'fishaudio' ? fishModelId : undefined, textLength: text.length });

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
    // 페르소나 TTS가 예정되어 있거나 재생 중이면 일반 TTS 재생하지 않음
    if (personaTTSScheduledRef.current || personaTTSPlayingRef.current) {
      console.log('[Chat] Persona TTS scheduled or playing, deferring response TTS');
      return;
    }
    
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
        console.log('[Chat] TTS attempting to set output device:', { sinkId, hasSinkIdSupport: typeof (audio as any).setSinkId === 'function' });
        if (sinkId && typeof (audio as any).setSinkId === 'function') {
          await (audio as any).setSinkId(sinkId);
          console.log('[Chat] TTS successfully set output device to:', sinkId);
        } else if (!sinkId) {
          console.log('[Chat] No output device selected, using default');
        } else {
          console.warn('[Chat] setSinkId not supported by browser');
        }
      } catch (e) { 
        console.error('[Chat] setSinkId failed:', e);
        // Don't fail playback if setSinkId fails, just use default output
      }
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
    await saveConversationHistory(activeRoomId, updatedMessages);
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
    await saveConversationHistory(activeRoomId, updatedMessages);
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

    // Apply input regex transforms to the user's input BEFORE anything else
    const rawInput = text.trim();
    const transformedInputForDisplay = applyRegexToInput(rawInput);

    const userMessage: Message = {
      role: 'user',
      // Show transformed text in the chat as well (입력문 수정은 UI에 반영)
      text: transformedInputForDisplay,
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
    setTtsActiveMessageIndex(null);
    setCompletedSentencesForDisplay([]);
    setCurrentTypingSentence('');

    // 페르소나 TTS 재생 시작 (비동기로 백그라운드에서 실행)
    let personaTTSPromise: Promise<void> | null = null;
    if (personaTTS) {
      console.log('[Chat] Persona TTS enabled, scheduling playback');
      personaTTSScheduledRef.current = true; // 페르소나 TTS 예약됨
      
      personaTTSPromise = (async () => {
        // Use transformed input for persona TTS as well
        const personaTTSUrl = await synthesizePersonaTTS(transformedInputForDisplay);
        
        if (personaTTSUrl) {
          personaTTSPlayingRef.current = true;
          const audio = new Audio(personaTTSUrl);
          
          // 출력 장치 설정
          try {
            const settings = await getSettings();
            const sinkId = (settings as any)?.selectedOutputId;
            if (sinkId && typeof (audio as any).setSinkId === 'function') {
              await (audio as any).setSinkId(sinkId);
            }
          } catch (e) {
            console.error('[Chat] Persona TTS setSinkId failed:', e);
          }

          // 페르소나 TTS 재생
          await new Promise<void>((resolve) => {
            audio.onended = () => {
              console.log('[Chat] Persona TTS playback ended');
              URL.revokeObjectURL(personaTTSUrl);
              personaTTSPlayingRef.current = false;
              personaTTSScheduledRef.current = false; // 예약 해제
              
              // 1~2초 랜덤 대기 후 일반 TTS 재생 시작
              const delay = 1000 + Math.random() * 1000; // 1000ms ~ 2000ms
              console.log(`[Chat] Waiting ${delay.toFixed(0)}ms before starting response TTS`);
              setTimeout(() => {
                // TTS 큐에 쌓인 것들 재생 시작
                attemptPlayNextOrdered();
                resolve();
              }, delay);
            };
            
            audio.onerror = () => {
              console.error('[Chat] Persona TTS playback error');
              URL.revokeObjectURL(personaTTSUrl);
              personaTTSPlayingRef.current = false;
              personaTTSScheduledRef.current = false; // 예약 해제
              // 에러 시에도 TTS 큐 재생 시도
              attemptPlayNextOrdered();
              resolve();
            };
            
            audio.play().catch((e) => {
              console.error('[Chat] Persona TTS play failed:', e);
              URL.revokeObjectURL(personaTTSUrl);
              personaTTSPlayingRef.current = false;
              personaTTSScheduledRef.current = false; // 예약 해제
              // 재생 실패 시에도 TTS 큐 재생 시도
              attemptPlayNextOrdered();
              resolve();
            });
          });
        } else {
          // URL 생성 실패 시에도 플래그 해제
          personaTTSScheduledRef.current = false;
        }
      })();
    }

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
  // Load the freshest author notes for the active room just-in-time
  let latestAuthorNotes = roomAuthorNotes;
  try { const fresh = await getRoomAuthorNotes(activeRoomIdRef.current || activeRoomId || 'default'); if (typeof fresh === 'string') latestAuthorNotes = fresh; } catch {}
  let builtMessages = await buildPromptMessages(promptBlocks, messages, { authorNotes: latestAuthorNotes });
      
      // Replace {{user_input}} placeholder with transformed user input
      builtMessages = builtMessages.map(msg => ({
        ...msg,
        content: msg.content.replace(/\{\{user_input\}\}/g, transformedInputForDisplay)
      }));

      // Apply request-data regex transforms to the entire prompt payload
      builtMessages = applyRegexToRequest(builtMessages);

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
              let text = parsed?.text ?? parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                // Apply output regex transforms before any display/TTS handling
                text = applyRegexToOutput(text);
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
        const finalSentence = applyRegexToOutput(sentenceBuffer.trim());
        completedSentences.push(finalSentence);
        enqueueTTSOrdered(finalSentence);
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
      await saveConversationHistory(activeRoomId, updatedMessages);
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

  // Apply regex scripts to message text to render HTML/CSS
  function applyRegexToText(text: string): { html: string; changed: boolean } {
    if (!regexScripts || regexScripts.length === 0) return { html: text, changed: false };
    let out = text;
    try {
      for (const s of regexScripts) {
        if (s.enabled === false) continue;
        if (s.type && s.type !== 'display') continue; // display-only here
        const flags = s.flags || 'g';
        try {
          const re = new RegExp(s.in, flags);
          out = out.replace(re, s.out);
        } catch {}
      }
      // Replace asset://name with actual data URI from card assets
      out = out.replace(/asset:\/\/([A-Za-z0-9_\-\.]+)/g, (_m, name) => assetMap[name] || _m);
      // Sanitize to disallow JS while allowing HTML/CSS
      const sanitized = sanitizeDisplayHtml(out);
      const changed = sanitized !== text;
      return { html: sanitized, changed };
    } catch {
      return { html: text, changed: false };
    }
  }

  // Very lightweight sanitizer: remove <script> tags, inline event handlers, and javascript: URLs
  function sanitizeDisplayHtml(html: string): string {
    try {
      let out = html;
      // Remove script tags entirely
      out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      // Remove on*="..." or on*='...' or on*=unquoted
      out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      // Neutralize javascript: in href/src/style urls
  out = out.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
      out = out.replace(/url\(\s*javascript:[^)]+\)/gi, 'url(#)');
      return out;
    } catch {
      return html;
    }
  }

  function applyRegexToRequest(messagesPayload: any): any {
    // Apply 'request' type regex to the entire serialized messages
    try {
      const enabled = regexScripts.filter(s=>s.enabled!==false && (s.type||'request')==='request');
      if (!enabled.length) return messagesPayload;
      let json = JSON.stringify(messagesPayload);
      for (const s of enabled){
        try { const re = new RegExp(s.in, s.flags||'g'); json = json.replace(re, s.out); } catch{}
      }
      return JSON.parse(json);
    } catch { return messagesPayload; }
  }

  function applyRegexToInput(text: string): string {
    try{
      const enabled = regexScripts.filter(s=>s.enabled!==false && s.type==='input');
      let out = text;
      for (const s of enabled){ try{ const re=new RegExp(s.in, s.flags||'g'); out = out.replace(re, s.out);}catch{} }
      return out;
    }catch{ return text; }
  }

  function applyRegexToOutput(text: string): string {
    try{
      const enabled = regexScripts.filter(s=>s.enabled!==false && s.type==='output');
      let out = text;
      for (const s of enabled){ try{ const re=new RegExp(s.in, s.flags||'g'); out = out.replace(re, s.out);}catch{} }
      return out;
    }catch{ return text; }
  }

  return (
    <main className="chat min-h-[60vh] flex flex-col">
      <div className="messages flex-1 p-4 md:p-6 overflow-auto space-y-4 custom-scrollbar">
        {messages.map((msg, idx) => (
          <div 
            key={idx} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            onContextMenu={(e) => handleContextMenu(e, idx)}
            onTouchStart={(e) => handleTouchStart(e, idx)}
            onTouchEnd={handleTouchEnd}
          >
            {editingIndex === idx ? (
              <div className="w-full md:w-[90%] mx-auto bg-slate-800/70 rounded-xl shadow-2xl p-5 border-2 border-teal-500">
                <textarea
                  className="w-full p-4 bg-slate-900/50 border border-slate-700/50 rounded-lg text-white placeholder-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/50 custom-scrollbar"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  autoFocus
                />
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={saveEditMessage}
                    className="px-5 py-2.5 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-lg hover:from-teal-600 hover:to-cyan-600 font-medium transition-all shadow-lg shadow-teal-500/30"
                  >
                    저장
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-5 py-2.5 bg-slate-700 text-slate-200 rounded-lg hover:bg-slate-600 font-medium transition-colors"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div 
                className={`max-w-[85%] md:max-w-[70%] message-bubble ${
                  msg.role === 'user' 
                    ? 'user' 
                    : 'assistant'
                }`}
              >
                <div className="whitespace-pre-wrap break-words text-sm md:text-base">
                  {msg.role === 'assistant' && ttsActiveMessageIndex === idx ? (
                    (() => {
                      const combined = [
                        completedSentencesForDisplay.join(' '),
                        completedSentencesForDisplay.length > 0 && currentTypingSentence ? ' ' + currentTypingSentence : (!completedSentencesForDisplay.length && currentTypingSentence ? currentTypingSentence : '')
                      ].join('');
                      if (!combined) return '\u200B';
                      const tr = applyRegexToText(combined);
                      if (tr.changed) {
                        return <div dangerouslySetInnerHTML={{ __html: tr.html }} />
                      }
                      return combined;
                    })()
                  ) : (
                    (() => {
                      const tr = applyRegexToText(msg.text);
                      if (tr.changed) {
                        return <div dangerouslySetInnerHTML={{ __html: tr.html }} />
                      }
                      return msg.text
                    })()
                  )}
                </div>
                <div className="text-xs opacity-60 mt-1.5">
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
          className="fixed bg-slate-800 rounded-lg shadow-2xl border border-slate-700/50 py-1 z-50 backdrop-blur-md"
          style={{ 
            left: `${contextMenu.x}px`, 
            top: `${contextMenu.y}px`,
            minWidth: '160px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => startEditMessage(contextMenu.messageIndex)}
            className="w-full px-4 py-2.5 text-left hover:bg-slate-700/50 text-sm flex items-center gap-2 text-slate-200 hover:text-white transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            편집
          </button>
          <button
            onClick={() => deleteMessage(contextMenu.messageIndex)}
            className="w-full px-4 py-2.5 text-left hover:bg-red-500/20 text-sm text-red-400 hover:text-red-300 flex items-center gap-2 transition-colors"
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
      
      {activeRoomId && activeRoomId !== 'default' ? (
        <footer className="composer flex items-center gap-2 md:gap-3 p-4">
          <button 
            onClick={toggleMic} 
            aria-pressed={listening} 
            title="Toggle microphone" 
            className={`w-11 h-11 md:w-12 md:h-12 rounded-xl flex items-center justify-center transition-all shadow-lg ${
              listening 
                ? 'bg-gradient-to-r from-teal-500 to-cyan-500 ring-2 ring-teal-400/50 shadow-teal-500/30' 
                : 'bg-slate-800 hover:bg-slate-700 shadow-slate-900/50'
            }`}
          >
            {listening ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-white"><rect x="7" y="5" width="10" height="10" rx="3" fill="currentColor" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><circle cx="12" cy="7" r="4" /><rect x="10" y="11" width="4" height="6" rx="1" fill="currentColor" stroke="none" /></svg>
            )}
          </button>
          <input 
            className="flex-1 px-4 py-3 md:py-3.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all" 
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
            className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white flex items-center justify-center shadow-lg shadow-teal-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
            title="Send message"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </footer>
      ) : (
        <div className="p-8 text-center text-slate-400">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-sm">채팅방을 선택하거나 생성하세요</p>
        </div>
      )}
    </main>
  )
}
