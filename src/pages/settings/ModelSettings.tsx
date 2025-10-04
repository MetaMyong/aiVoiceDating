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
