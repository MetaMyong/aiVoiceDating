import React from 'react';

type T = { id:number, text:string, kind?: 'info'|'success'|'error' };

let idCounter = 1;
const listeners: ((s:T[])=>void)[] = [];
let state: T[] = [];

export function pushToast(text:string, kind:'info'|'success'|'error'='info', ttl=3000){
  const id = idCounter++;
  state = [...state, { id, text, kind }];
  listeners.forEach(l=>l(state));
  setTimeout(()=>{
    state = state.filter(t=>t.id!==id);
    listeners.forEach(l=>l(state));
  }, ttl);
}

export function useToasts(){
  const [list, setList] = React.useState<T[]>(state);
  React.useEffect(()=>{
    const l = (s:T[])=>setList(s);
    listeners.push(l);
    return ()=>{ const i = listeners.indexOf(l); if(i>=0) listeners.splice(i,1); };
  },[]);
  return list;
}

export default function ToastContainer(){
  const toasts = useToasts();
  return (
    <div style={{position:'fixed',right:12,bottom:12,zIndex:9999, display:'flex', flexDirection:'column-reverse', alignItems:'flex-end'}}>
      {toasts.map(t=> (
        <div key={t.id} style={{marginBottom:8,padding:'8px 12px',borderRadius:6,background: t.kind==='error'? '#f8d7da': t.kind==='success' ? '#d4edda' : '#e2e3e5', color:'#111', boxShadow:'0 2px 6px rgba(0,0,0,0.12)'}}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
