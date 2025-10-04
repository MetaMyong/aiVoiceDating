import React, { useEffect, useState } from 'react'
import { getSettings, setSettings } from '../lib/indexeddb'
import { pushToast } from './Toast'

export default function Settings(){
  const [cfg, setCfg] = useState<any>({});
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    (async ()=>{
      try{
        const s = await getSettings(); if(s) setCfg(s); else setCfg({});
      }catch(e){ setStatus('설정 로드 실패'); }
    })();
  }, []);

  async function handleSave(e:any){
    e.preventDefault(); setStatus('저장 중...');
    const body = Object.assign({
      sttProvider: cfg.sttProvider || 'google',
      ttsProvider: cfg.ttsProvider || 'gemini',
      geminiTtsVoiceName: cfg.geminiTtsVoiceName || '',
      geminiTtsModel: cfg.geminiTtsModel || 'gemini-2.5-flash-preview-tts',
      geminiApiKey: cfg.geminiApiKey || '',
      geminiModel: cfg.geminiModel || 'gemini-2.5-flash',
      fishAudioApiKey: cfg.fishAudioApiKey || '',
      fishAudioModelId: cfg.fishAudioModelId || ''
    }, cfg || {});
    try{
      await setSettings(body);
      setStatus('저장 성공');
      setCfg(body);
      pushToast('설정이 저장되었습니다','success');
    }catch(e){ setStatus('저장 실패'); pushToast('설정 저장 실패','error'); console.error(e); }
  }

  return (
    <form className="p-3" onSubmit={handleSave}>
      <div className="mb-3">
        <label className="block text-sm font-medium text-slate-300">TTS Provider</label>
        <select className="mt-1 block w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.ttsProvider || 'gemini'} onChange={e=>setCfg({...cfg, ttsProvider:e.target.value})}>
          <option value="gemini">Gemini</option>
          <option value="fishaudio">FishAudio</option>
        </select>
      </div>
      <div className="mb-3">
        <label className="block text-sm font-medium text-slate-300">Gemini Voice</label>
        <input className="mt-1 block w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.geminiTtsVoiceName||''} onChange={e=>setCfg({...cfg, geminiTtsVoiceName:e.target.value})} />
      </div>
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">{status}</div>
        <button className="px-3 py-2 bg-accent text-white rounded">Save</button>
      </div>
    </form>
  )
}
