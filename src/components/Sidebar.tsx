import React from 'react'
import { getSettings, setSettings } from '../lib/indexeddb'
import JSZip from 'jszip'

export default function Sidebar({ onCardSelect, className }: { onCardSelect?: () => void; className?: string } = {}) {
  const [cards, setCards] = React.useState<any[]>([])
  const [selectedCardIndex, setSelectedCardIndex] = React.useState<number | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    (async () => {
      try{
        const cfg = await getSettings();
        setCards(cfg?.characterCards || [])
        setSelectedCardIndex(typeof cfg?.selectedCharacterCardIndex === 'number' ? cfg.selectedCharacterCardIndex : null)
      }catch{}
    })()
  },[])

  async function onPickFiles(){
    fileRef.current?.click()
  }

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>){
    const file = e.target.files?.[0]
    if(!file) return
    try{
      // FileReader를 사용하여 안전하게 data URL 생성 (대용량에서도 안전)
      const reader = new FileReader()
      reader.onload = async (ev) => {
        const dataUrl = String(ev.target?.result || '')
        // charx/png에서 캐릭터 이름을 얻기 위해 일부 메타를 별도로 보관
        const item = { name: file.name, dataUrl, ts: Date.now(), card: null as any }
        const cfg = (await getSettings()) || {}
        const list = Array.isArray(cfg.characterCards) ? cfg.characterCards.slice() : []
        list.push(item)
        cfg.characterCards = list
        await setSettings(cfg)
        setCards(list)
        window.dispatchEvent(new CustomEvent('characterCardsUpdate'))
        // 이름 보강: PNG/CHARX에 내장된 카드 JSON을 파싱하여 card.data.name 추출 시 UI 이름 덮어쓰기
        try{
          const parsed = await tryParseCardFromDataUrl(dataUrl)
          if(parsed){
            const cfg2 = await getSettings()
            const list2 = cfg2.characterCards.slice()
            list2[list2.length-1] = { ...list2[list2.length-1], card: parsed, name: parsed?.data?.name || list2[list2.length-1].name }
            cfg2.characterCards = list2
            await setSettings(cfg2)
            setCards(list2)
            window.dispatchEvent(new CustomEvent('characterCardsUpdate'))
          }
        }catch{}
      }
      reader.readAsDataURL(file)
    } finally {
      if (e.target) e.target.value = ''
    }
  }

  async function selectCard(index: number){
    setSelectedCardIndex(index)
    const cfg = (await getSettings()) || {}
    cfg.selectedCharacterCardIndex = index
    await setSettings(cfg)
    window.dispatchEvent(new CustomEvent('characterSelectionChanged', { detail: { index } }))
    if (onCardSelect) onCardSelect()
  }

  async function removeCard(index:number){
    const cfg = (await getSettings()) || {}
    const list = Array.isArray(cfg.characterCards) ? cfg.characterCards.slice() : []
    list.splice(index,1)
    cfg.characterCards = list
    if(cfg.selectedCharacterCardIndex === index){ cfg.selectedCharacterCardIndex = null }
    await setSettings(cfg)
    setCards(list)
    setSelectedCardIndex(null)
    window.dispatchEvent(new CustomEvent('characterCardsUpdate'))
  }

  function openEditor(index:number){
    ;(window as any).__editingCardIndex = index
    window.dispatchEvent(new CustomEvent('openCardEditor', { detail: { index } }))
  }

  async function tryParseCardFromDataUrl(dataUrl:string):Promise<any|null>{
    try{
      const [meta, b64] = dataUrl.split(',')
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      // If content is actually a ZIP (.charx), detect by magic 'PK' even if mime says image
      const isZip = bin.length > 4 && bin[0] === 0x50 && bin[1] === 0x4b
      if (isZip) {
        try{
          const zip = await JSZip.loadAsync(bin)
          const file = zip.file('card.json') || zip.file('data/card.json') || zip.file('character.json')
          if(file){
            const str = await file.async('string')
            return JSON.parse(str)
          }
        }catch{}
      }
      // PNG: tEXt/iTXt ccv3/chara 지원
      if(meta.includes('image/png')){
        if(bin[0]!==0x89 || bin[1]!==0x50) return null
        let pos=8
        let found=''
        while(pos < bin.length){
          const len=(bin[pos]<<24)|(bin[pos+1]<<16)|(bin[pos+2]<<8)|bin[pos+3]; pos+=4
          const type=String.fromCharCode(bin[pos],bin[pos+1],bin[pos+2],bin[pos+3]); pos+=4
          if(type==='tEXt' || type==='iTXt' || type==='zTXt'){
            // tEXt: keyword (latin1) 0x00 then text (latin1). iTXt has additional fields; handle both.
            let p = pos
            // keyword
            let keyEnd=p; while(keyEnd<pos+len && bin[keyEnd]!==0) keyEnd++
            const key=String.fromCharCode(...Array.from(bin.slice(p,keyEnd)))
            p = keyEnd + 1
            if(type==='iTXt'){
              // iTXt fields: compressionFlag(1), compressionMethod(1), languageTag(NUL-term), translatedKeyword(NUL-term), then text (UTF-8)
              const compFlag = bin[p]; p+=1
              const compMethod = bin[p]; p+=1
              // languageTag
              while(p<pos+len && bin[p]!==0) p++
              p+=1
              // translatedKeyword
              while(p<pos+len && bin[p]!==0) p++
              p+=1
              // remaining is text
              const data = bin.slice(p, pos+len)
              if(key==='ccv3'||key==='chara'){
                // Most card payloads are base64 JSON string; if not, treat as utf8 JSON
                const txt = new TextDecoder('utf-8').decode(data)
                found = txt
              }
            } else if (type==='zTXt') {
              // zTXt: compressionMethod(1), then compressed text
              const compMethod = bin[p]; p+=1
              const compData = bin.slice(p, pos+len)
              try{
                const { inflate } = await import('pako')
                const inflated = inflate(compData)
                if(key==='ccv3'||key==='chara'){
                  found = new TextDecoder('latin1').decode(inflated)
                }
              }catch{}
            } else {
              // tEXt simple latin1
              if(key==='ccv3'||key==='chara'){
                const data=bin.slice(p, pos+len)
                found = new TextDecoder('latin1').decode(data)
              }
            }
          }
          pos += len + 4
          if(type==='IEND') break
        }
        if(found){
          // Try base64 first
          try {
            const u8 = Uint8Array.from(atob(found), c=>c.charCodeAt(0))
            return JSON.parse(new TextDecoder().decode(u8))
          } catch {
            // Then raw JSON
            try { return JSON.parse(found) } catch { return null }
          }
        }
      }
      // .charx: zip with card.json inside
      if(meta.includes('application/zip') || meta.includes('application/x-zip-compressed')){
        try{
          const zip = await JSZip.loadAsync(bin)
          // Common paths: card.json, data/card.json
          const file = zip.file('card.json') || zip.file('data/card.json') || zip.file('character.json')
          if(file){
            const str = await file.async('string')
            return JSON.parse(str)
          }
        }catch{}
      }
    }catch{}
    return null
  }

  return (
    <aside className={`sidebar flex-col bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-r border-slate-700/50 ${className || ''}`}>
      <div className="brand flex items-center gap-3 px-4 py-6">
        <svg width="48" height="48" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{stopColor:'#14b8a6', stopOpacity:1}} />
              <stop offset="100%" style={{stopColor:'#06b6d4', stopOpacity:1}} />
            </linearGradient>
          </defs>
          <circle cx="256" cy="180" r="70" fill="url(#grad1)"/>
          <path d="M 256 260 C 180 260 160 300 160 360 L 160 380 L 352 380 L 352 360 C 352 300 332 260 256 260 Z" fill="url(#grad1)"/>
          <path d="M 380 140 L 480 140 C 490 140 498 148 498 158 L 498 218 C 498 228 490 236 480 236 L 440 236 L 420 260 L 420 236 L 380 236 C 370 236 362 228 362 218 L 362 158 C 362 148 370 140 380 140 Z" fill="url(#grad1)" opacity="0.8"/>
          <path d="M 430 170 C 430 165 426 161 421 161 C 418 161 415 163 413 165 C 411 163 408 161 405 161 C 400 161 396 165 396 170 C 396 178 413 190 413 190 C 413 190 430 178 430 170 Z" fill="#0f172a"/>
        </svg>
        <span className="text-white text-xl font-bold tracking-wide" style={{fontFamily: 'Pacifico, cursive'}}>AI Voice Dating</span>
      </div>
      <div className="conversations flex-1 px-4 overflow-y-auto custom-scrollbar">
        {/* Character Card Imports (rectangular slots) */}
        <div className="py-3">
          <div className="text-xs text-slate-500 mb-3 font-medium">캐릭터 카드</div>
          <div className="flex flex-col gap-2">
            {cards.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 border rounded-lg p-3 text-sm transition-all ${selectedCardIndex===i? 'border-teal-500 bg-teal-500/10 shadow-lg shadow-teal-500/20' : 'border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/50'}`}>
                <button onClick={() => selectCard(i)} className={`flex-1 text-left truncate font-medium ${selectedCardIndex===i ? 'text-cyan-400' : 'text-slate-300 hover:text-white'}`} title={c.name}>{c.name}</button>
                <button onClick={() => openEditor(i)} title="편집" className="p-1.5 hover:bg-slate-700/50 rounded text-slate-400 hover:text-white transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button onClick={() => removeCard(i)} title="삭제" className="p-1.5 hover:bg-red-500/20 rounded text-red-400 hover:text-red-300 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                </button>
              </div>
            ))}
            <button onClick={onPickFiles} className="mt-1 border-2 border-dashed border-slate-700/50 rounded-lg h-20 grid place-items-center hover:border-teal-500 hover:bg-teal-500/10 transition-all group">
              <span className="text-3xl text-slate-600 group-hover:text-cyan-400 transition-colors">+</span>
            </button>
          </div>
        </div>
      </div>
  <input ref={fileRef} type="file" accept="image/png,image/jpeg,.charx,.zip,application/zip,application/x-zip-compressed" onChange={onFilesSelected} className="hidden" />
      {/* Settings button */}
      <button 
        onClick={() => { window.location.href = '/settings'; }}
        className="mt-4 w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gradient-to-r from-slate-800 to-slate-700 hover:from-slate-700 hover:to-slate-600 text-white transition-all shadow-lg hover:shadow-xl"
        aria-label="설정"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.4 13.3c.1-.6.1-1.2.1-1.8s0-1.2-.1-1.8l2-1.6c.2-.2.2-.5.1-.8l-1.9-3.3c-.1-.3-.4-.4-.7-.3l-2.4 1c-.5-.4-1-.7-1.6-.9L14.6.6c0-.3-.3-.5-.6-.5h-3.9c-.3 0-.6.2-.6.5L9 4.1c-.6.2-1.2.5-1.6.9L5 3.9c-.3-.1-.6 0-.7.3L2.4 7.5c-.1.3-.1.6.1.8l2 1.6c-.1.6-.1 1.2-.1 1.8s0 1.2.1 1.8l-2 1.6c-.2.2-.2.5-.1.8l1.9 3.3c.1.3.4.4.7.3l2.4-1c.5.4 1 .7 1.6.9l.2 3.5c0 .3.3.5.6.5h3.9c.3 0 .6-.2.6-.5l.2-3.5c.6-.2 1.1-.5 1.6-.9l2.4 1c.3.1.6 0 .7-.3l1.9-3.3c.1-.3.1-.6-.1-.8l-2-1.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
        </svg>
        <span className="font-medium">설정</span>
      </button>
    </aside>
  )
}
