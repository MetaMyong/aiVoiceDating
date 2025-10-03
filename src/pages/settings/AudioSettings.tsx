import React, { useEffect, useState, useRef } from 'react'
import { getSettings as idbGetSettings, setSettings as idbSetSettings } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export default function AudioSettings(props:any){
  const { leftSection, audioTab, cfg, setCfg } = props;
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [selectedOutputId, setSelectedOutputId] = useState<string>('');
  const [monitorOn, setMonitorOn] = useState<boolean>(false);
  const [threshold, setThreshold] = useState<number>(-40);
  const thresholdRef = useRef<number>(threshold);
  useEffect(()=>{ thresholdRef.current = threshold; },[threshold]);
  const [playbackVolume, setPlaybackVolume] = useState<number>(1);
  const [level, setLevel] = useState<number>(0);
  const [levelDb, setLevelDb] = useState<number>(-200);

  const audioCtxRef = useRef<AudioContext|null>(null);
  const srcRef = useRef<any|null>(null);
  const analyserRef = useRef<any|null>(null);
  const gainRef = useRef<any|null>(null);
  const audioElRef = useRef<HTMLAudioElement|null>(null);

  async function refreshDevices(){
    try{
      if(!(navigator && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d=>d.kind==='audioinput');
      const outputs = devices.filter(d=>d.kind==='audiooutput');
      setInputDevices(inputs as MediaDeviceInfo[]);
      setOutputDevices(outputs as MediaDeviceInfo[]);
      if(!selectedInputId && inputs.length>0){ setSelectedInputId(inputs[0].deviceId); }
      if(!selectedOutputId && outputs.length>0){ setSelectedOutputId(outputs[0].deviceId); }
    }catch(e){ console.warn('refreshDevices failed', e); }
  }

  useEffect(()=>{
    (async ()=>{
      try{
        const s = await idbGetSettings();
        if(s){
          if(s.selectedInputId) setSelectedInputId(s.selectedInputId);
          if(s.selectedOutputId) setSelectedOutputId(s.selectedOutputId);
          if(typeof s.threshold === 'number'){ setThreshold(s.threshold); thresholdRef.current = s.threshold; }
          if(typeof s.playbackVolume === 'number') setPlaybackVolume(s.playbackVolume);
        }
      }catch(e){ console.warn('load audio settings failed', e); }
      try{ await refreshDevices(); }catch(e){}
    })();
  },[]);

  useEffect(()=>{
    let raf: number = 0;
    async function startMonitor(){
      if(!selectedInputId) return;
      try{
        try{ if(audioCtxRef.current){ try{ (audioCtxRef.current as any).close(); }catch(e){} } }catch(e){}
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ac = new AudioCtx({ latencyHint: 'interactive' });
        audioCtxRef.current = ac;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: selectedInputId ? { exact: selectedInputId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints });
        const audioEl = audioElRef.current || document.createElement('audio');
        audioEl.autoplay = true; audioEl.muted = false;
        audioElRef.current = audioEl;

        try{ audioEl.srcObject = stream; audioEl.volume = playbackVolume; }catch(e){ console.warn('assign raw stream failed', e); }
        if(typeof (audioEl as any).setSinkId === 'function' && selectedOutputId){
          try{ await (audioEl as any).setSinkId(selectedOutputId); }catch(e){ console.warn('setSinkId failed', e); }
        }

        const src = ac.createMediaStreamSource(stream);
        srcRef.current = src;
        const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyserRef.current = analyser;
        src.connect(analyser);

        const buf = new Uint8Array(analyser.fftSize);
        function tick(){
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for(let i=0;i<buf.length;i++){ const v = (buf[i]-128)/128; sum += v*v; }
          const rms = Math.sqrt(sum / buf.length);
          setLevel(rms);
          const db = rms > 0 ? (20 * Math.log10(rms)) : -200;
          setLevelDb(db);
          try{
            const curThreshold = thresholdRef.current;
            if(audioElRef.current){
              if(db < curThreshold){
                audioElRef.current.volume = 0;
              } else {
                audioElRef.current.volume = playbackVolume;
              }
            }
          }catch(e){}
          raf = requestAnimationFrame(tick);
        }
        tick();
      }catch(e){ console.error('monitor start', e); }
    }
    function stopMonitor(){
      try{ if(raf) cancelAnimationFrame(raf); }catch(e){}
      try{ if(srcRef.current){ /* nothing else to do */ } }catch(e){}
      try{ if(audioElRef.current){ const s = audioElRef.current.srcObject as MediaStream; if(s){ s.getTracks().forEach(t=>t.stop()); } audioElRef.current.srcObject = null; } }catch(e){}
      try{ if(audioCtxRef.current){ try{ (audioCtxRef.current as any).close(); }catch(e){} audioCtxRef.current = null; } }catch(e){}
      srcRef.current = null; analyserRef.current = null; gainRef.current = null;
    }
    if(monitorOn){ startMonitor(); } else { stopMonitor(); }
    return ()=>{ stopMonitor(); };
  },[monitorOn, selectedInputId, selectedOutputId, playbackVolume, thresholdRef]);

  useEffect(()=>{
    try{
      if(audioElRef.current){ audioElRef.current.volume = playbackVolume; }
      if(gainRef.current && gainRef.current.gain) { gainRef.current.gain.value = playbackVolume; }
    }catch(e){}
  },[playbackVolume]);

  function fmtDeviceLabel(d:MediaDeviceInfo){ return d.label || (d.kind==='audioinput' ? '마이크' : '스피커'); }

  async function saveCfg(){
    try{
      const newCfg = { ...(cfg||{}) , selectedInputId, selectedOutputId, threshold, playbackVolume };
      setCfg(newCfg);
      await idbSetSettings(newCfg);
      pushToast('오디오 설정이 저장되었습니다','success');
    }catch(e){ pushToast('오디오 설정 저장 실패','error'); }
  }

  if(leftSection !== 'audio') return null;
  return (
    <>
      {audioTab === 'record' && (
        <section className="bg-white rounded shadow p-8">
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium">녹음 장치 선택</label>
                <div className="flex gap-2 mt-2">
                  <select className="flex-1 rounded border px-3 py-2" value={selectedInputId} onChange={async e=>{ const v = e.target.value; setSelectedInputId(v); try{ await saveCfg(); }catch(_){}}}>
                    {inputDevices.length===0 ? <option>장치 없음</option> : inputDevices.map((d:any)=>(<option key={d.deviceId} value={d.deviceId}>{fmtDeviceLabel(d)}</option>))}
                  </select>
                  <button type="button" className="px-3 py-2 bg-gray-200 rounded" onClick={refreshDevices}>새로고침</button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={()=>setMonitorOn((x:boolean)=>!x)} className={`px-3 py-2 rounded ${monitorOn? 'bg-orange-500 text-white':'bg-gray-200 text-gray-700'}`}>{monitorOn? 'MONITOR ON':'MONITOR OFF'}</button>
                    <div className="text-sm text-gray-600">모니터 레벨</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-56">
                      <div style={{height:12, background:'#eee', borderRadius:6, overflow:'hidden'}}>
                        {(() => {
                          const pct = Math.min(100, Math.round(level*100));
                          const color = pct < 40 ? '#2ecc71' : (pct < 75 ? '#f1c40f' : '#e74c3c');
                          return (<div style={{width:`${pct}%`, height:12, background: color}} />)
                        })()}
                      </div>
                    </div>
                    <div className="text-sm font-mono text-gray-700 w-12 text-right">{Math.min(100, Math.round(level*100))}%</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">Threshold (dB)</div>
                <div className="flex items-center gap-3">
                  <input type="range" min={-80} max={0} step={0.5} value={threshold} onChange={async e=>{ const v = Number(e.target.value); setThreshold(v); thresholdRef.current = v; try{ await saveCfg(); }catch(_){ } }} className="w-full mt-2" />
                  <div className="text-sm font-mono w-20 text-right">{threshold} dB</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
      {audioTab === 'play' && (
        <section className="bg-white rounded shadow p-8">
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium">재생 장치 선택</label>
                <div className="flex gap-2 mt-2">
                  <select className="flex-1 rounded border px-3 py-2" value={selectedOutputId} onChange={async e=>{ const v = e.target.value; setSelectedOutputId(v); try{ await saveCfg(); }catch(_){}}}>
                    {outputDevices.length===0 ? <option>장치 없음</option> : outputDevices.map((d:any)=>(<option key={d.deviceId} value={d.deviceId}>{fmtDeviceLabel(d)}</option>))}
                  </select>
                  <button type="button" className="px-3 py-2 bg-gray-200 rounded" onClick={async ()=>{
                    try{
                      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
                      const ac = new AudioCtx({ latencyHint: 'interactive' });
                      const o = ac.createOscillator(); const g = ac.createGain();
                      o.type = 'sine'; o.frequency.value = 1000; g.gain.value = playbackVolume;
                      o.connect(g);
                      const dest = ac.createMediaStreamDestination();
                      g.connect(dest);
                      const tempAudio = document.createElement('audio'); tempAudio.autoplay = true; tempAudio.srcObject = dest.stream; tempAudio.volume = playbackVolume;
                      if(typeof (tempAudio as any).setSinkId === 'function' && selectedOutputId){ try{ await (tempAudio as any).setSinkId(selectedOutputId); }catch(e){ console.warn('temp setSinkId failed', e); } }
                      o.start();
                      setTimeout(()=>{ try{ o.stop(); }catch(e){} try{ ac.close(); }catch(e){} try{ tempAudio.srcObject = null; }catch(e){} }, 2000);
                    }catch(e){ console.error('test tone', e); }
                  }}>테스트</button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between"><div className="text-sm text-gray-600">재생 볼륨</div><div className="text-xs text-gray-500">{Math.round(playbackVolume*100)}%</div></div>
                <input type="range" min={0} max={1} step={0.01} value={playbackVolume} onChange={async e=>{ const v = Number(e.target.value); setPlaybackVolume(v); try{ await saveCfg(); }catch(_){}}} className="w-full mt-2" />
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
