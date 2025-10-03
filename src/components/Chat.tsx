import React, { useState, useRef, useEffect } from 'react'
import { getSettings, getConversationHistory, saveConversationHistory } from '../lib/indexeddb'
import { buildPromptMessages, PromptBlock } from '../lib/promptBuilder'

interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export default function Chat(){
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [useStreaming, setUseStreaming] = useState(true);
  
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Play TTS for assistant message
  async function playTTS(text: string) {
    try {
      const settings = await getSettings();
      const provider = settings?.ttsProvider || 'gemini';
      const apiKey = settings?.geminiApiKey || settings?.fishAudioApiKey;
      const voice = settings?.geminiTtsVoiceName || 'Zephyr';
      const model = settings?.geminiTtsModel;

      console.log('[Chat] TTS request:', { provider, voice, textLength: text.length });

      const response = await fetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, provider, apiKey, voice, model })
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Stop previous audio if playing
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          audioRef.current = null;
        };

        await audio.play();
        console.log('[Chat] TTS playing');
      } else {
        console.error('[Chat] TTS error:', response.status);
      }
    } catch (error) {
      console.error('[Chat] TTS playback error:', error);
    }
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
        { name: '사용자 입력', type: 'pure', prompt: '{user_input}', role: 'user' }
      ];

      // Build messages
      let builtMessages = buildPromptMessages(promptBlocks, newMessages);
      
      // Replace {user_input} placeholder with actual user input
      builtMessages = builtMessages.map(msg => ({
        ...msg,
        content: msg.content.replace('{user_input}', text.trim())
      }));

      console.log('[Chat] Built messages for LLM:', builtMessages);

      if (useStreaming) {
        // Use streaming API
        const response = await fetch('/api/llm/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: builtMessages,
            model: settings?.geminiModel || 'gemini-2.5-flash',
            apiKey: settings?.geminiApiKey
          })
        });

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status}`);
        }

        // Read SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  break;
                }
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.text) {
                    accumulatedText += parsed.text;
                    setStreamingText(accumulatedText);
                    console.log('[Chat] Stream chunk:', parsed.text);
                  }
                } catch (e) {
                  // Ignore parse errors
                }
              }
            }
          }
        }

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

        // Play TTS
        if (accumulatedText) {
          await playTTS(accumulatedText);
        }

      } else {
        // Use non-streaming API
        const response = await fetch('/api/llm/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: builtMessages,
            model: settings?.geminiModel || 'gemini-2.5-flash',
            apiKey: settings?.geminiApiKey
          })
        });

        if (!response.ok) {
          throw new Error(`LLM API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[Chat] LLM response:', data);

        const assistantMessage: Message = {
          role: 'assistant',
          text: data.text || 'No response',
          timestamp: new Date().toISOString()
        };

        const updatedMessages = [...newMessages, assistantMessage];
        setMessages(updatedMessages);
        
        // Save conversation history
        await saveConversationHistory('default', updatedMessages);
        console.log('[Chat] Conversation saved');

        // Play TTS
        if (data.text) {
          await playTTS(data.text);
        }
      }

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
        <button 
          onClick={() => setUseStreaming(!useStreaming)} 
          title={useStreaming ? '스트리밍 켜짐' : '스트리밍 꺼짐'}
          className={`w-10 h-10 rounded-lg shadow-lg border flex items-center justify-center ${useStreaming ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        </button>
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
