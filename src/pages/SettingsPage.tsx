import React, { useEffect, useState, useRef } from 'react'
import BackButton from '../components/BackButton'
import { getSettings as idbGetSettings, setSettings as idbSetSettings, getFishModels as idbGetFishModels, setFishModels as idbSetFishModels } from '../lib/indexeddb'
import PromptSettings from './settings/PromptSettings'
import ModelSettings from './settings/ModelSettings'
import AudioSettings from './settings/AudioSettings'
import AdvancedSettings from './settings/AdvancedSettings'
import { pushToast } from '../components/Toast'

export default function SettingsPage(){
  const [tab, setTab] = useState<'llm'|'stt'|'tts'|'api'|'prompt'>('llm');
  const [leftSection, setLeftSection] = useState<'prompt'|'model'|'audio'|'advanced'>('prompt');
  const [audioTab, setAudioTab] = useState<'record'|'play'>('record');

  const [cfg, setCfg] = useState<any>({});
  const [status, setStatus] = useState('');

  const [fishModels, setFishModels] = useState<Array<any>>([]);
  const [loadingFishModels, setLoadingFishModels] = useState(false);
  const [fishError, setFishError] = useState('');

  const [promptBlocks, setPromptBlocks] = useState<any[]>([
    { id: 'block-sys-1', name: '시스템 프롬프트', type: 'pure', prompt: 'You are a helpful AI assistant.', role: 'user' },
    { id: 'block-conv-2', name: '대화 이력', type: 'conversation', prompt: '', role: 'user' },
    { id: 'block-input-3', name: '사용자 입력', type: 'pure', prompt: '{user_input}', role: 'user' }
  ]);
  const [promptRightTab, setPromptRightTab] = useState<'params'|'blocks'|'other'>('blocks');
  // Track expanded panels by block ID (stable across reorders)
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string,boolean>>({});
  const dragIndexRef = useRef<number|null>(null);
  // Child-local prompt blocks reference for global Save
  const promptLocalRef = useRef<any[] | null>(null);

  // audio
  useEffect(()=>{
    (async ()=>{
      try{
        const s = await idbGetSettings();
        if(s){
          setCfg(s);
          if(s.promptBlocks) {
            // Ensure all blocks have IDs
            const blocksWithIds = s.promptBlocks.map((b: any, i: number) => 
              b.id ? b : { ...b, id: `block-${Date.now()}-${i}` }
            );
            setPromptBlocks(blocksWithIds);
          }
        }
        try{ const fm = await idbGetFishModels(); if(fm) setFishModels(fm); }catch(e){}
      }catch(e){ console.warn('load settings failed', e); }
    })();
  },[]);

  // audio logic moved to AudioSettings component

  async function saveCfg(){
    try{
  // Persist latest child-local edits if available
  const effectiveBlocks = promptLocalRef.current ?? promptBlocks;
  // Sync parent state to latest before save
  setPromptBlocks(effectiveBlocks);
  await idbSetSettings({ ...cfg, promptBlocks: effectiveBlocks });
      await idbSetFishModels(fishModels || []);
      setStatus('설정이 로컬에 저장되었습니다');
      pushToast('설정이 저장되었습니다','success');
      setTimeout(()=>setStatus(''),2000);
    }catch(e){ setStatus('저장 실패'); pushToast('설정 저장 실패','error'); setTimeout(()=>setStatus(''),2000); }
  }

  function PromptPanel(){
    return (
      <PromptSettings
        cfg={cfg}
        setCfg={setCfg}
        promptBlocks={promptBlocks}
        setPromptBlocks={setPromptBlocks}
        promptRightTab={promptRightTab}
        setPromptRightTab={setPromptRightTab}
        expandedBlocks={expandedBlocks}
        setExpandedBlocks={setExpandedBlocks}
        dragIndexRef={dragIndexRef}
  promptLocalRef={promptLocalRef}
      />
    )
  }

  const geminiModels = ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-flash-preview-09-2025','gemini-2.5-flash-lite-preview-09-2025'];
  const geminiTtsModels = [{ value: 'gemini-2.5-flash-preview-tts', label: 'gemini-2.5-flash-preview-tts' },{ value: 'gemini-2.5-pro-preview-tts', label: 'gemini-2.5-pro-preview-tts' }];
  const geminiVoices: { value: string; label: string; gender?: string; desc?: string }[] = [
    { value: 'Achernar', label: 'Achernar', gender: '여성', desc: 'Soft · 여성' },
    { value: 'Achird', label: 'Achird', gender: '남성', desc: 'Friendly · 남성' },
    { value: 'Algenib', label: 'Algenib', gender: '남성', desc: 'Gravelly · 남성' },
    { value: 'Algieba', label: 'Algieba', gender: '남성', desc: 'Smooth · 남성' },
    { value: 'Alnilam', label: 'Alnilam', gender: '남성', desc: 'Firm · 남성' },
    { value: 'Aoede', label: 'Aoede', gender: '여성', desc: 'Breezy · 여성' },
    { value: 'Autonoe', label: 'Autonoe', gender: '여성', desc: 'Bright · 여성' },
    { value: 'Callirrhoe', label: 'Callirrhoe', gender: '여성', desc: 'Easy-going · 여성' },
    { value: 'Charon', label: 'Charon', gender: '남성', desc: 'Informative · 남성' },
    { value: 'Despina', label: 'Despina', gender: '여성', desc: 'Smooth · 여성' },
    { value: 'Enceladus', label: 'Enceladus', gender: '남성', desc: 'Breathy · 남성' },
    { value: 'Erinome', label: 'Erinome', gender: '여성', desc: 'Clear · 여성' },
    { value: 'Fenrir', label: 'Fenrir', gender: '남성', desc: 'Excitable · 남성' },
    { value: 'Gacrux', label: 'Gacrux', gender: '여성', desc: 'Mature · 여성' },
    { value: 'Iapetus', label: 'Iapetus', gender: '남성', desc: 'Clear · 남성' },
    { value: 'Kore', label: 'Kore', gender: '여성', desc: 'Firm · 여성' },
    { value: 'Laomedeia', label: 'Laomedeia', gender: '여성', desc: 'Upbeat · 여성' },
    { value: 'Leda', label: 'Leda', gender: '여성', desc: 'Youthful · 여성' },
    { value: 'Orus', label: 'Orus', gender: '남성', desc: 'Firm · 남성' },
    { value: 'Pulcherrima', label: 'Pulcherrima', gender: '여성', desc: 'Forward · 여성' },
    { value: 'Puck', label: 'Puck', gender: '남성', desc: 'Upbeat · 남성' },
    { value: 'Rasalgethi', label: 'Rasalgethi', gender: '남성', desc: 'Informative · 남성' },
    { value: 'Sadachbia', label: 'Sadachbia', gender: '여성', desc: 'Lively · 여성' },
    { value: 'Sadaltager', label: 'Sadaltager', gender: '남성', desc: 'Knowledgeable · 남성' },
    { value: 'Schedar', label: 'Schedar', gender: '남성', desc: 'Even · 남성' },
    { value: 'Sulafat', label: 'Sulafat', gender: '여성', desc: 'Warm · 여성' },
    { value: 'Umbriel', label: 'Umbriel', gender: '남성', desc: 'Easy-going · 남성' },
    { value: 'Vindemiatrix', label: 'Vindemiatrix', gender: '여성', desc: 'Gentle · 여성' },
    { value: 'Zephyr', label: 'Zephyr', gender: '여성', desc: 'Bright · 여성' },
    { value: 'Zubenelgenubi', label: 'Zubenelgenubi', gender: '남성', desc: 'Casual · 남성' }
  ];
  const sttProviders = [{ value: 'google', label: 'Google STT' },{ value: 'fishaudio', label: 'FishAudio' }];
  const ttsProviders = [{ value: 'gemini', label: 'Gemini (Google)' },{ value: 'fishaudio', label: 'FishAudio' }];

  return (
    <div className="min-h-[80vh] flex justify-center w-[1192px] mx-auto">
      <div className="flex">
        <aside className="w-48 bg-gray-50 border-r p-6 flex flex-col gap-4">
          <button onClick={()=>setLeftSection('prompt')} className={`text-left px-2 py-2 rounded ${leftSection==='prompt'?'bg-orange-100 text-orange-600 font-bold':''}`}>프롬프트</button>
          <button onClick={()=>setLeftSection('model')} className={`text-left px-2 py-2 rounded ${leftSection==='model'?'bg-orange-100 text-orange-600 font-bold':''}`}>모델</button>
          <button onClick={()=>setLeftSection('audio')} className={`text-left px-2 py-2 rounded ${leftSection==='audio'?'bg-orange-100 text-orange-600 font-bold':''}`}>오디오</button>
          <button onClick={()=>setLeftSection('advanced')} className={`text-left px-2 py-2 rounded ${leftSection==='advanced'?'bg-orange-100 text-orange-600 font-bold':''}`}>고급설정</button>
        </aside>

        <main className="w-[1000px] p-0 flex flex-col items-stretch">
          <div className="relative px-4 py-4">
            <div className="flex gap-1 mb-0 justify-start">
              {leftSection === 'audio' ? (
                <>
                  <button type="button" className={`px-3 py-2 rounded ${audioTab==='record'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`} onClick={()=>setAudioTab('record')}>녹음</button>
                  <button type="button" className={`px-3 py-2 rounded ${audioTab==='play'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`} onClick={()=>setAudioTab('play')}>재생</button>
                </>
              ) : leftSection === 'model' ? (
                <>
                  <button onClick={()=>setTab('llm')} className={`px-3 py-2 rounded ${tab==='llm'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>LLM</button>
                  <button onClick={()=>setTab('stt')} className={`px-3 py-2 rounded ${tab==='stt'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>STT</button>
                  <button onClick={()=>setTab('tts')} className={`px-3 py-2 rounded ${tab==='tts'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>TTS</button>
                  <button onClick={()=>setTab('api')} className={`px-3 py-2 rounded ${tab==='api'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>API</button>
                </>
              ) : leftSection === 'prompt' ? (
                <>
                  <button onClick={()=>setPromptRightTab('params')} className={`px-3 py-2 rounded ${promptRightTab==='params'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>파라미터</button>
                  <button onClick={()=>setPromptRightTab('blocks')} className={`px-3 py-2 rounded ${promptRightTab==='blocks'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>프롬프트 블록</button>
                  <button onClick={()=>setPromptRightTab('other')} className={`px-3 py-2 rounded ${promptRightTab==='other'?'bg-orange-500 text-white font-bold':'bg-white text-gray-700 border border-gray-300'}`}>기타</button>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-gray-100 rounded-b-lg shadow-inner px-6 py-6">
            {leftSection === 'audio' && (
              <AudioSettings leftSection={leftSection} audioTab={audioTab} cfg={cfg} setCfg={setCfg} />
            )}

            {leftSection === 'model' && (
              <ModelSettings
                tab={tab}
                cfg={cfg}
                setCfg={setCfg}
                geminiModels={geminiModels}
                geminiTtsModels={geminiTtsModels}
                geminiVoices={geminiVoices}
                sttProviders={sttProviders}
                ttsProviders={ttsProviders}
                fishModels={fishModels}
                setFishModels={setFishModels}
                loadingFishModels={loadingFishModels}
                setLoadingFishModels={setLoadingFishModels}
                fishError={fishError}
                setFishError={setFishError}
                
              />
            )}

            {leftSection === 'prompt' && <PromptPanel />}

            {leftSection === 'advanced' && (
              <AdvancedSettings cfg={cfg} setCfg={setCfg} />
            )}

            <div style={{height: '160px'}} />
          </div>

        </main>
      </div>

      <div className="fixed right-6 top-4 z-40"><BackButton /></div>
      <div className="fixed left-1/2 transform -translate-x-1/2 bottom-6 z-40"><button onClick={()=>saveCfg()} className="px-4 py-3 bg-accent text-white rounded shadow-lg">Save</button></div>
    </div>
  )
}
