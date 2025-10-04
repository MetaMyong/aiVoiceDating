import React, { useEffect, useState, useRef } from 'react'
import { getSettings as idbGetSettings, setSettings as idbSetSettings, getFishModels as idbGetFishModels, setFishModels as idbSetFishModels } from '../lib/indexeddb'
import PromptSettings from './settings/PromptSettings'
import ModelSettings from './settings/ModelSettings'
import AudioSettings from './settings/AudioSettings'
import PersonaSettings from './settings/PersonaSettings'
import AdvancedSettings from './settings/AdvancedSettings'
import { pushToast } from '../components/Toast'

export default function SettingsPage(){
  // 초기 상태를 sessionStorage에서 복원
  const [tab, setTab] = useState<'llm'|'stt'|'tts'|'api'|'prompt'>(() => {
    const saved = sessionStorage.getItem('settingsTab');
    return (saved as any) || 'llm';
  });
  const [leftSection, setLeftSection] = useState<'prompt'|'model'|'audio'|'persona'|'advanced'>(() => {
    const saved = sessionStorage.getItem('settingsLeftSection');
    return (saved as any) || 'prompt';
  });
  const [audioTab, setAudioTab] = useState<'record'|'play'>(() => {
    const saved = sessionStorage.getItem('settingsAudioTab');
    return (saved as any) || 'record';
  });

  const [cfg, setCfg] = useState<any>({});
  const [status, setStatus] = useState('');

  const [fishModels, setFishModels] = useState<Array<any>>([]);
  const [loadingFishModels, setLoadingFishModels] = useState(false);
  const [fishError, setFishError] = useState('');

  const [promptBlocks, setPromptBlocks] = useState<any[]>([
    { id: 'block-sys-1', name: '시스템 프롬프트', type: 'pure', prompt: '# Persona\nYou are AI assistant. Always respond with helpful 2 to 4 sentences in Korean. DO NOT USE *MARKDOWN* or Emojis, () or [] brackets.', role: 'user' },
    { id: 'block-conv-2', name: '대화 이력', type: 'conversation', prompt: '', role: 'user' },
    { id: 'block-input-3', name: '사용자 입력', type: 'pure', prompt: '{{user_input}}', role: 'user' }
  ]);
  const [promptRightTab, setPromptRightTab] = useState<'params'|'blocks'|'other'>(() => {
    const saved = sessionStorage.getItem('settingsPromptRightTab');
    return (saved as any) || 'blocks';
  });
  // Save hook from AudioSettings to ensure latest audio selections are persisted before global save
  const audioSaveRef = useRef<null | (() => Promise<void>)>(null);
  // Commit hook from PromptSettings to commit drafts before save
  const promptCommitRef = useRef<null | (() => void)>(null);
  // Track expanded panels by block ID (stable across reorders)
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string,boolean>>({});
  const dragIndexRef = useRef<number|null>(null);
  // Child-local prompt blocks reference for global Save
  const promptLocalRef = useRef<any[] | null>(null);

  // 탭 변경 시 sessionStorage에 저장
  useEffect(() => {
    sessionStorage.setItem('settingsTab', tab);
  }, [tab]);

  useEffect(() => {
    sessionStorage.setItem('settingsLeftSection', leftSection);
  }, [leftSection]);

  useEffect(() => {
    sessionStorage.setItem('settingsAudioTab', audioTab);
  }, [audioTab]);

  useEffect(() => {
    sessionStorage.setItem('settingsPromptRightTab', promptRightTab);
  }, [promptRightTab]);

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
  // Ensure latest audio settings are saved before consolidating cfg
  if (audioSaveRef.current) {
    try { await audioSaveRef.current(); } catch (e) { /* ignore child save errors, continue */ }
  }
  // Commit prompt drafts before reading
  if (promptCommitRef.current) {
    try { promptCommitRef.current(); } catch (e) { /* ignore */ }
  }
  // Wait a tick for state updates
  await new Promise(resolve => setTimeout(resolve, 10));
  // Persist latest child-local edits if available
  const effectiveBlocks = promptLocalRef.current ?? promptBlocks;
  // Sync parent state to latest before save
  setPromptBlocks(effectiveBlocks);
  // Read latest settings from IndexedDB and merge with current cfg state
  const latest = await idbGetSettings();
  // cfg에는 페르소나 정보 등 최신 상태가 들어있으므로 cfg를 우선으로 병합
  await idbSetSettings({ ...(latest || {}), ...cfg, promptBlocks: effectiveBlocks });
      await idbSetFishModels(fishModels || []);
      setStatus('설정이 로컬에 저장되었습니다');
      pushToast('설정이 저장되었습니다','success');
      
      // 저장 완료 후 페이지 새로고침 (탭 상태는 sessionStorage에서 복원됨)
      setTimeout(() => {
        window.location.reload();
      }, 300); // 토스트 메시지가 보이도록 짧은 딜레이 후 새로고침
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
        promptCommitRef={promptCommitRef}
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex justify-center">
      <div className="flex w-full max-w-[1192px]">
        <aside className="hidden md:flex w-48 bg-slate-800/50 border-r border-slate-700/50 p-6 flex-col gap-2">
          <button onClick={()=>setLeftSection('prompt')} className={`text-left px-3 py-2.5 rounded-lg transition-all ${leftSection==='prompt'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}>프롬프트</button>
          <button onClick={()=>setLeftSection('model')} className={`text-left px-3 py-2.5 rounded-lg transition-all ${leftSection==='model'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}>모델</button>
          <button onClick={()=>setLeftSection('audio')} className={`text-left px-3 py-2.5 rounded-lg transition-all ${leftSection==='audio'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}>오디오</button>
          <button onClick={()=>setLeftSection('persona')} className={`text-left px-3 py-2.5 rounded-lg transition-all ${leftSection==='persona'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}>페르소나</button>
          <button onClick={()=>setLeftSection('advanced')} className={`text-left px-3 py-2.5 rounded-lg transition-all ${leftSection==='advanced'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'text-slate-300 hover:bg-slate-700/50 hover:text-white'}`}>고급설정</button>
        </aside>

        <main className="flex-1 md:w-[1000px] p-0 flex flex-col items-stretch">
          <div className="relative px-4 py-4 bg-slate-800/30 border-b border-slate-700/50">
            <div className="flex gap-2 mb-0 justify-start flex-wrap">
              {leftSection === 'audio' ? (
                <>
                  <button type="button" className={`px-4 py-2 rounded-lg transition-all ${audioTab==='record'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`} onClick={()=>setAudioTab('record')}>녹음</button>
                  <button type="button" className={`px-4 py-2 rounded-lg transition-all ${audioTab==='play'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`} onClick={()=>setAudioTab('play')}>재생</button>
                </>
              ) : leftSection === 'model' ? (
                <>
                  <button onClick={()=>setTab('llm')} className={`px-4 py-2 rounded-lg transition-all ${tab==='llm'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>LLM</button>
                  <button onClick={()=>setTab('stt')} className={`px-4 py-2 rounded-lg transition-all ${tab==='stt'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>STT</button>
                  <button onClick={()=>setTab('tts')} className={`px-4 py-2 rounded-lg transition-all ${tab==='tts'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>TTS</button>
                  <button onClick={()=>setTab('api')} className={`px-4 py-2 rounded-lg transition-all ${tab==='api'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>API</button>
                </>
              ) : leftSection === 'prompt' ? (
                <>
                  <button onClick={()=>setPromptRightTab('params')} className={`px-4 py-2 rounded-lg transition-all ${promptRightTab==='params'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>파라미터</button>
                  <button onClick={()=>setPromptRightTab('blocks')} className={`px-4 py-2 rounded-lg transition-all ${promptRightTab==='blocks'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>프롬프트 블록</button>
                  <button onClick={()=>setPromptRightTab('other')} className={`px-4 py-2 rounded-lg transition-all ${promptRightTab==='other'?'bg-gradient-to-r from-teal-600 to-cyan-600 text-white font-semibold shadow-lg':'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'}`}>기타</button>
                </>
              ) : null}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-slate-900/50 rounded-b-lg shadow-inner px-4 md:px-6 py-6 overflow-y-auto custom-scrollbar">
            {leftSection === 'audio' && (
              <AudioSettings leftSection={leftSection} audioTab={audioTab} cfg={cfg} setCfg={setCfg} onRegisterSave={(fn: ()=>Promise<void>)=>{ audioSaveRef.current = fn; }} />
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

            {leftSection === 'persona' && (
              <PersonaSettings cfg={cfg} setCfg={setCfg} />
            )}

            {leftSection === 'advanced' && (
              <AdvancedSettings cfg={cfg} setCfg={setCfg} />
            )}

            <div style={{height: '160px'}} />
          </div>

        </main>
      </div>

      {/* 뒤로가기 버튼 */}
      <button 
        onClick={() => { window.location.href = '/'; }}
        className="fixed left-6 top-6 w-10 h-10 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-colors shadow-lg z-50"
        aria-label="뒤로가기"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>

      {/* 저장 버튼 */}
      <button 
        onMouseDown={(e) => e.preventDefault()}
        onClick={()=>saveCfg()} 
        className="fixed left-1/2 transform -translate-x-1/2 bottom-6 px-6 py-3 bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white rounded-lg shadow-lg hover:shadow-xl transition-all font-medium z-50"
      >
        저장
      </button>
    </div>
  )
}
