import React from 'react'
import { IconRobot, IconCog } from '../../components/Icons'
import { setFishModels as idbSetFishModels } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export default function ModelSettings(props:any){
  const { cfg, setCfg, geminiModels, geminiTtsModels, geminiVoices, sttProviders, ttsProviders, fishModels, setFishModels, loadingFishModels, setLoadingFishModels, fishError, setFishError, refreshDevices } = props;
  return (
    <div>
      {/** LLM */}
      {props.tab === 'llm' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
          <div className="relative grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-3 text-sm font-bold text-slate-300 flex items-center gap-2">
              <IconRobot className="w-5 h-5 text-teal-400" /> LLM 제공자
            </div>
            <div className="md:col-span-9 font-bold bg-gradient-to-r from-teal-400 to-cyan-400 bg-clip-text text-transparent">Gemini (Google)</div>
            <div className="md:col-span-3 text-sm font-bold text-slate-300 flex items-center gap-2">
              <IconCog className="w-5 h-5 text-cyan-400" /> 모델 선택
            </div>
            <div className="md:col-span-9">
              <select className="w-full rounded-xl border-2 border-slate-700/50 bg-slate-800/60 text-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all shadow-inner" value={cfg.geminiModel||geminiModels[0]} onChange={e=>setCfg({...cfg, geminiModel:e.target.value})}>
                {geminiModels.map((m:any)=>(<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
          </div>
        </section>
      )}
      {/** STT */}
      {props.tab === 'stt' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
          <div className="relative grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-bold text-slate-300 flex items-center gap-2">
              <IconCog className="w-5 h-5 text-purple-400" /> STT 제공자
            </div>
            <div className="md:col-span-9">
              <select className="w-full rounded-xl border-2 border-slate-700/50 bg-slate-800/60 text-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all shadow-inner" value={cfg.sttProvider||'google'} onChange={e=>setCfg({...cfg, sttProvider:e.target.value})}>
                {sttProviders.map((p:any)=>(<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
            </div>
          </div>
        </section>
      )}
      {/** TTS */}
      {props.tab === 'tts' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>TTS 제공자</div>
            <div className="md:col-span-9">
              <select className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.ttsProvider||'gemini'} onChange={e=>setCfg({...cfg, ttsProvider:e.target.value})}>
                {ttsProviders.map((p:any)=>(<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
            </div>
            {cfg.ttsProvider==='gemini' && (
              <>
                <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>Gemini TTS 모델</div>
                <div className="md:col-span-9">
                  <select className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.geminiTtsModel||geminiTtsModels[0].value} onChange={e=>setCfg({...cfg, geminiTtsModel:e.target.value})}>
                    {geminiTtsModels.map((m:any)=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                </div>
                <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>목소리(voiceName)</div>
                <div className="md:col-span-9">
                  <select className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.geminiVoiceName||geminiVoices[0].value} onChange={e=>setCfg({...cfg, geminiVoiceName:e.target.value})}>
                    {geminiVoices.map((v:any)=>(<option key={v.value} value={v.value}>{v.label}</option>))}
                  </select>
                  <div className="text-xs text-slate-400 mt-1">
                    {geminiVoices.find((v:any)=>v.value===cfg.geminiVoiceName)?.desc || geminiVoices[0].desc}
                  </div>
                </div>
              </>
            )}
            {cfg.ttsProvider === 'fishaudio' && (
              <>
                <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>FishAudio 모델</div>
                <div className="md:col-span-9">
                  <div className="flex items-center gap-3">
                    <select 
                      className="flex-1 rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/50" 
                      value={cfg.fishAudioModelId || (fishModels && fishModels.length > 0 ? (fishModels[0].id || fishModels[0].modelId) : '')} 
                      onChange={e=>setCfg({...cfg, fishAudioModelId:e.target.value})}
                    >
                      {(fishModels || []).length === 0 ? (
                        <option value="">모델 없음 (API 키 설정 후 새로고침)</option>
                      ) : (
                        (fishModels || []).map((m:any)=>(<option key={m.id||m.modelId} value={m.id||m.modelId}>{m.name||m.id||m.modelId}</option>))
                      )}
                    </select>
                    <button type="button" className="px-3 py-2 rounded bg-slate-700/60 text-slate-200 hover:bg-slate-600/70 border border-slate-600/50" onClick={async ()=>{
                      setLoadingFishModels(true); setFishError('');
                      const q = cfg.fishAudioApiKey ? `?apiKey=${encodeURIComponent(cfg.fishAudioApiKey)}` : '';
                      const controller = new AbortController();
                      const to = setTimeout(()=>controller.abort(), 10000);
                      async function tryFetch(url:string){
                        const r = await fetch(url, { signal: controller.signal });
                        const text = await r.text();
                        return { ok: r.ok, status: r.status, text };
                      }
                      try{
                        // 1) Try relative path first (works when dev server proxies API)
                        const relUrl = `/api/fishaudio/models${q}`;
                        let res = await tryFetch(relUrl);
                        // Detect HTML (starts with '<') or non-JSON by attempting to parse
                        let parsed:any = null;
                        let usedUrl = relUrl;
                        if(res.ok){
                          try{ parsed = res.text ? JSON.parse(res.text) : {}; }catch(e){ parsed = null; }
                          if(parsed == null){
                            // fallback to backend host
                            const backend = `http://127.0.0.1:3000/api/fishaudio/models${q}`;
                            usedUrl = backend;
                            res = await tryFetch(backend);
                          }
                        }
                        if(!res.ok){
                          let msg = `status ${res.status}`;
                          try{ const body = JSON.parse(res.text||'{}'); msg = body.error || body.message || msg; }catch(e){ msg = `${msg}: ${res.text?.slice(0,200)}`; }
                          setFishError(msg);
                          pushToast('FishAudio 모델 로드 실패: '+msg,'error');
                          return;
                        }
                        // parse final response
                        try{ parsed = res.text ? JSON.parse(res.text) : {}; }catch(e){
                          const short = (res.text||'').slice(0,300);
                          const msg = '서버가 JSON이 아닌 응답을 반환했습니다: ' + short;
                          setFishError(msg);
                          pushToast('FishAudio 모델 로드 실패: 서버 응답이 JSON이 아닙니다','error');
                          console.error('Non-JSON response from', usedUrl, res.text);
                          return;
                        }
                        const models = parsed.models || parsed || [];
                        setFishModels(models);
                        try{ await idbSetFishModels(models); }catch(e){ console.error('idb set fish', e); }
                        // Auto-select first model if none selected
                        if (models.length > 0 && !cfg.fishAudioModelId) {
                          const firstModelId = models[0].id || models[0].modelId;
                          setCfg({...cfg, fishAudioModelId: firstModelId});
                        }
                        pushToast('FishAudio 모델 로드 완료','success');
                      }catch(err:any){
                        const msg = err?.name === 'AbortError' ? '요청 타임아웃 (10s)' : (err?.message || '모델 로드 실패');
                        setFishError(msg);
                        pushToast('FishAudio 모델 로드 실패: '+msg,'error');
                      }finally{
                        clearTimeout(to);
                        setLoadingFishModels(false);
                      }
                    }}>{loadingFishModels? '...' : 'Load'}</button>
                  </div>
                  {fishError && <div className="text-xs text-red-600 mt-1">{fishError}</div>}
                </div>
              </>
            )}
          </div>
        </section>
      )}
      {/** API */}
      {props.tab === 'api' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>Google API 키</div>
            <div className="md:col-span-9">
              <input className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.geminiApiKey||''} onChange={e=>setCfg({...cfg, geminiApiKey:e.target.value})} placeholder="Google API Key" />
            </div>
            <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>Google 서비스키 (JSON)</div>
            <div className="md:col-span-9">
              <textarea className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 font-mono text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" rows={4} value={cfg.googleServiceKey||''} onChange={e=>setCfg({...cfg, googleServiceKey:e.target.value})} placeholder="{...json...}" />
            </div>
            <div className="md:col-span-3 text-sm font-semibold text-slate-300" style={{width:'12rem'}}>FishAudio API 키</div>
            <div className="md:col-span-9">
              <input className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 text-white px-3 py-2 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" value={cfg.fishAudioApiKey||''} onChange={e=>setCfg({...cfg, fishAudioApiKey:e.target.value})} placeholder="FishAudio API Key" />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
