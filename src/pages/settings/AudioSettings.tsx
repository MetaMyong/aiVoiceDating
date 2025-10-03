import React, { useEffect, useState, useRef } from 'react'
import { getSettings as idbGetSettings, setSettings as idbSetSettings } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export default function AudioSettings(props:any){
  const { leftSection, audioTab, cfg, setCfg, onRegisterSave } = props;
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(cfg?.selectedInputId || '');
  const [selectedOutputId, setSelectedOutputId] = useState<string>(cfg?.selectedOutputId || '');
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

  // 장치 권한을 선요청하고 enumerateDevices를 호출합니다.
  type RefreshOpts = {
    forceRequestPermission?: boolean,
    preferredInputId?: string,
    preferredOutputId?: string,
    preferredInputLabel?: string,
    preferredOutputLabel?: string,
    persistOnChange?: boolean,
  };
  async function refreshDevices(opts: RefreshOpts = {}){
    const { 
      forceRequestPermission = false,
      preferredInputId,
      preferredOutputId,
      preferredInputLabel,
      preferredOutputLabel,
      persistOnChange = false,
    } = opts;
    try{
      if(!(navigator && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return;
      // 권한이 없거나 목록이 비는 경우를 대비하여, 필요 시 오디오 권한을 먼저 요청
      if (forceRequestPermission || (inputDevices.length===0 && outputDevices.length===0)){
        try{
          const test = await navigator.mediaDevices.getUserMedia({ audio: true });
          // 곧바로 정지해 리소스 낭비 방지
          try{ test.getTracks().forEach(t=>t.stop()); }catch(_){/*noop*/}
        }catch(err:any){
          console.warn('getUserMedia for permission failed', err);
          // 사용자 거부나 장치 없음일 수 있으므로 알림
          if(err && (err.name==='NotAllowedError' || err.name==='SecurityError')){
            pushToast('마이크 권한이 거부되었습니다. 브라우저 사이트 권한에서 마이크 허용 후 다시 시도하세요.','error');
          }else if(err && err.name==='NotFoundError'){
            pushToast('사용 가능한 마이크 장치를 찾을 수 없습니다. 연결 상태를 확인하세요.','error');
          }
        }
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d=>d.kind==='audioinput');
      const outputs = devices.filter(d=>d.kind==='audiooutput');
      setInputDevices(inputs as MediaDeviceInfo[]);
      setOutputDevices(outputs as MediaDeviceInfo[]);
      
      // 장치 목록만 업데이트하고, 선택된 장치는 변경하지 않음
      // (초기 로드 시 useEffect에서 이미 설정했으므로)
    }catch(e){ console.warn('refreshDevices failed', e); }
  }

  useEffect(()=>{
    (async ()=>{
      try{
        const s = await idbGetSettings();
        if(s){
          if(typeof s.threshold === 'number'){ setThreshold(s.threshold); thresholdRef.current = s.threshold; }
          if(typeof s.playbackVolume === 'number') setPlaybackVolume(s.playbackVolume);
          
          // 권한 요청 및 장치 목록 먼저 로드
          await refreshDevices({ forceRequestPermission: true });
          
          // 장치 목록 로드 후, 저장된 값으로 설정 (이렇게 하면 드롭다운에 올바른 값이 표시됨)
          if(s.selectedInputId) setSelectedInputId(s.selectedInputId);
          if(s.selectedOutputId) setSelectedOutputId(s.selectedOutputId);
        } else {
          // 설정 없으면 권한만 요청
          await refreshDevices({ forceRequestPermission: true });
        }
      }catch(e){ 
        console.warn('load audio settings failed', e);
        try{ await refreshDevices({ forceRequestPermission: true }); }catch(_){/*noop*/}
      }
    })();
  },[]);

  // 장치 플러그/언플러그나 OS 변경에 반응하도록 devicechange 리스너 추가
  useEffect(()=>{
    const handler = ()=>{ 
      refreshDevices(); 
    };
    try{ navigator?.mediaDevices?.addEventListener?.('devicechange', handler); }catch(_){/*noop*/}
    return ()=>{ try{ navigator?.mediaDevices?.removeEventListener?.('devicechange', handler); }catch(_){/*noop*/} };
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

        let stream: MediaStream | null = null;
        try{
          stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: selectedInputId ? { exact: selectedInputId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } as MediaTrackConstraints });
        }catch(err:any){
          // 선택된 장치가 사라진 경우 등 Overconstrained 에러 폴백
          if(err && (err.name==='OverconstrainedError' || err.name==='NotFoundError')){
            console.warn('Selected input not available, falling back to default device');
            pushToast('선택한 녹음 장치를 찾을 수 없어 기본 장치로 전환합니다.','info');
            await refreshDevices({ forceRequestPermission: true });
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          }else{
            throw err;
          }
        }
        if(!stream) return;
        const audioEl = audioElRef.current || document.createElement('audio');
        audioEl.autoplay = true; audioEl.muted = false;
        audioElRef.current = audioEl;

        try{ audioEl.srcObject = stream; audioEl.volume = playbackVolume; }catch(e){ console.warn('assign raw stream failed', e); }
        if(typeof (audioEl as any).setSinkId === 'function' && selectedOutputId){
          try{ await (audioEl as any).setSinkId(selectedOutputId); }catch(e:any){
            console.warn('setSinkId failed', e);
            // 권한/정책 문제 안내
            pushToast('스피커 선택에 실패했습니다. 브라우저가 출력 장치 변경을 지원하지 않거나, 보안 컨텍스트(HTTPS/localhost)가 아닐 수 있습니다.','info');
          }
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
      }catch(e:any){
        console.error('monitor start', e);
        if(e && e.name==='NotAllowedError'){
          pushToast('마이크 권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인하세요.','error');
        }else{
          pushToast('오디오 모니터 시작에 실패했습니다. 콘솔 로그를 확인하세요.','error');
        }
      }
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

  async function saveCfg(overrides?: Partial<{ selectedInputId: string; selectedOutputId: string; threshold: number; playbackVolume: number; }>) {
    try{
      const nextInputId = overrides?.selectedInputId ?? selectedInputId;
      const nextOutputId = overrides?.selectedOutputId ?? selectedOutputId;
      const nextThreshold = overrides?.threshold ?? threshold;
      const nextPlaybackVolume = overrides?.playbackVolume ?? playbackVolume;

      const inLabel = inputDevices.find(d=>d.deviceId===nextInputId)?.label || '';
      const outLabel = outputDevices.find(d=>d.deviceId===nextOutputId)?.label || '';

      const newCfg = { 
        ...(cfg||{}),
        selectedInputId: nextInputId,
        selectedOutputId: nextOutputId,
        selectedInputLabel: inLabel,
        selectedOutputLabel: outLabel,
        threshold: nextThreshold,
        playbackVolume: nextPlaybackVolume
      };
      setCfg(newCfg);
      await idbSetSettings(newCfg);
      pushToast('오디오 설정이 저장되었습니다','success');
    }catch(e){ pushToast('오디오 설정 저장 실패','error'); }
  }

  // Register parent-triggered save to persist the current selection values
  useEffect(()=>{
    if(typeof onRegisterSave === 'function'){
      onRegisterSave(async ()=>{
        await saveCfg({
          selectedInputId,
          selectedOutputId,
          threshold,
          playbackVolume,
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[onRegisterSave, selectedInputId, selectedOutputId, threshold, playbackVolume, inputDevices, outputDevices]);

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
                  <select className="flex-1 rounded border px-3 py-2" value={selectedInputId} onChange={async e=>{ 
                    const v = e.target.value; 
                    const label = inputDevices.find(d=>d.deviceId===v)?.label || '';
                    setSelectedInputId(v);
                    const current = await idbGetSettings();
                    const updated = { ...(current||{}), selectedInputId: v, selectedInputLabel: label };
                    await idbSetSettings(updated);
                    setCfg(updated);
                  }}>
                    {inputDevices.length===0 ? <option>장치 없음</option> : inputDevices.map((d:any)=>(<option key={d.deviceId} value={d.deviceId}>{fmtDeviceLabel(d)}</option>))}
                  </select>
                  <button type="button" className="px-3 py-2 bg-gray-200 rounded" onClick={()=>refreshDevices({ forceRequestPermission: true })}>새로고침</button>
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
                  <input type="range" min={-80} max={0} step={0.5} value={threshold} onChange={async e=>{ const v = Number(e.target.value); setThreshold(v); thresholdRef.current = v; try{ await saveCfg({ threshold: v }); }catch(_){ } }} className="w-full mt-2" />
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
                  <select className="flex-1 rounded border px-3 py-2" value={selectedOutputId} onChange={async e=>{ 
                    const v = e.target.value; 
                    const label = outputDevices.find(d=>d.deviceId===v)?.label || '';
                    setSelectedOutputId(v);
                    const current = await idbGetSettings();
                    const updated = { ...(current||{}), selectedOutputId: v, selectedOutputLabel: label };
                    await idbSetSettings(updated);
                    setCfg(updated);
                  }}>
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
                <input type="range" min={0} max={1} step={0.01} value={playbackVolume} onChange={async e=>{ const v = Number(e.target.value); setPlaybackVolume(v); try{ await saveCfg({ playbackVolume: v }); }catch(_){}}} className="w-full mt-2" />
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
