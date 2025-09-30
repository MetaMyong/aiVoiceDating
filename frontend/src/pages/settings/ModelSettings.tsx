import React from 'react'
import { setFishModels as idbSetFishModels } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export default function ModelSettings(props:any){
  const { cfg, setCfg, geminiModels, geminiTtsModels, geminiVoices, sttProviders, ttsProviders, fishModels, setFishModels, loadingFishModels, setLoadingFishModels, fishError, setFishError, refreshDevices } = props;
  return (
    <div>
      {/** LLM */}
      {props.tab === 'llm' && (
        <section className="bg-white rounded shadow p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>LLM 제공자</div>
            <div className="md:col-span-9 font-bold text-gray-700">Gemini (Google)</div>
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>모델 선택</div>
            <div className="md:col-span-9">
              <select className="w-full rounded border px-3 py-2" value={cfg.geminiModel||geminiModels[0]} onChange={e=>setCfg({...cfg, geminiModel:e.target.value})}>
                {geminiModels.map((m:any)=>(<option key={m} value={m}>{m}</option>))}
              </select>
            </div>
          </div>
        </section>
      )}
      {/** STT */}
      {props.tab === 'stt' && (
        <section className="bg-white rounded shadow p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>STT 제공자</div>
            <div className="md:col-span-9">
              <select className="w-full rounded border px-3 py-2" value={cfg.sttProvider||'google'} onChange={e=>setCfg({...cfg, sttProvider:e.target.value})}>
                {sttProviders.map((p:any)=>(<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
            </div>
          </div>
        </section>
      )}
      {/** TTS */}
      {props.tab === 'tts' && (
        <section className="bg-white rounded shadow p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>TTS 제공자</div>
            <div className="md:col-span-9">
              <select className="w-full rounded border px-3 py-2" value={cfg.ttsProvider||'gemini'} onChange={e=>setCfg({...cfg, ttsProvider:e.target.value})}>
                {ttsProviders.map((p:any)=>(<option key={p.value} value={p.value}>{p.label}</option>))}
              </select>
            </div>
            {cfg.ttsProvider==='gemini' && (
              <>
                <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>Gemini TTS 모델</div>
                <div className="md:col-span-9">
                  <select className="w-full rounded border px-3 py-2" value={cfg.geminiTtsModel||geminiTtsModels[0].value} onChange={e=>setCfg({...cfg, geminiTtsModel:e.target.value})}>
                    {geminiTtsModels.map((m:any)=>(<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                </div>
                <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>목소리(voiceName)</div>
                <div className="md:col-span-9">
                  <select className="w-full rounded border px-3 py-2" value={cfg.geminiVoiceName||geminiVoices[0].value} onChange={e=>setCfg({...cfg, geminiVoiceName:e.target.value})}>
                    {geminiVoices.map((v:any)=>(<option key={v.value} value={v.value}>{v.label}</option>))}
                  </select>
                  <div className="text-xs text-gray-500 mt-1">
                    {geminiVoices.find((v:any)=>v.value===cfg.geminiVoiceName)?.desc || geminiVoices[0].desc}
                  </div>
                </div>
              </>
            )}
            {cfg.ttsProvider === 'fishaudio' && (
              <>
                <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>FishAudio 모델</div>
                <div className="md:col-span-9">
                  <div className="flex items-center gap-3">
                    <select className="flex-1 rounded border px-3 py-2" value={cfg.fishAudioModelId||''} onChange={e=>setCfg({...cfg, fishAudioModelId:e.target.value})}>
                      {(fishModels || []).length === 0 ? (
                        <option value="">모델 없음</option>
                      ) : (
                        (fishModels || []).map((m:any)=>(<option key={m.id||m.modelId} value={m.id||m.modelId}>{m.name||m.id||m.modelId}</option>))
                      )}
                    </select>
                    <button type="button" className="px-3 py-2 bg-gray-200 rounded" onClick={async ()=>{
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
        <section className="bg-white rounded shadow p-8">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>Google API 키</div>
            <div className="md:col-span-9">
              <input className="w-full rounded border px-3 py-2" value={cfg.geminiApiKey||''} onChange={e=>setCfg({...cfg, geminiApiKey:e.target.value})} placeholder="Google API Key" />
            </div>
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>Google 서비스키 (JSON)</div>
            <div className="md:col-span-9">
              <textarea className="w-full rounded border px-3 py-2 font-mono text-xs" rows={4} value={cfg.googleServiceKey||''} onChange={e=>setCfg({...cfg, googleServiceKey:e.target.value})} placeholder="{...json...}" />
            </div>
            <div className="md:col-span-3 text-sm font-semibold" style={{width:'12rem'}}>FishAudio API 키</div>
            <div className="md:col-span-9">
              <input className="w-full rounded border px-3 py-2" value={cfg.fishAudioApiKey||''} onChange={e=>setCfg({...cfg, fishAudioApiKey:e.target.value})} placeholder="FishAudio API Key" />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
