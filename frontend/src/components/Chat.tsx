import React, { useState, useRef } from 'react'

export default function Chat(){
  const [listening, setListening] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  async function toggleMic(){
    if (!listening) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = s;
        setListening(true);
        // TODO: send audio to server/WebRTC
      } catch (e) {
        console.error('Mic access denied', e);
      }
    } else {
      try {
        streamRef.current?.getTracks().forEach(t => t.stop());
      } catch (e) {}
      streamRef.current = null;
      setListening(false);
    }
  }

  return (
    <main className="chat min-h-[60vh] flex flex-col">
      <div className="messages flex-1 p-4 overflow-auto">
        <div className="msg bot">안녕, 자기!</div>
      </div>
      <footer className="composer flex items-center gap-2 p-4">
        <button onClick={toggleMic} aria-pressed={listening} title="Toggle microphone" className={`w-10 h-10 rounded-lg bg-white shadow-lg border flex items-center justify-center ${listening ? 'ring-2 ring-red-300' : ''}`}>
          {listening ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="10" height="10" rx="3" fill="currentColor" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4" /><rect x="10" y="11" width="4" height="6" rx="1" fill="currentColor" stroke="none" /></svg>
          )}
        </button>
        <input className="flex-1 px-4 py-3 rounded-lg border bg-white" placeholder="Say something..." />
        <button className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center shadow-lg" title="Send message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      </footer>
    </main>
  )
}
