import React, { useEffect, useMemo, useState, useLayoutEffect, useRef, useCallback } from 'react'
import { getChatRooms, setChatRooms, getActiveChatRoom, setActiveChatRoom } from '../lib/indexeddb'
import { IconTrash, IconCog, IconNote } from './Icons'

type RegexScript = {
  id?: string
  name?: string
  type?: 'request' | 'display' | 'input' | 'output' | 'disabled'
  in: string
  out: string
  flags?: string
  enabled?: boolean
}

// Draft types for text input fields
type LoreDraft = {
  name: string
  order: string
  keys: string
  content: string
}

type ScriptDraft = {
  name: string
  in: string
  flags: string
  out: string
}

// Separate components to prevent re-render on parent state change
const LoreInput = React.memo(({ 
  id, 
  value, 
  placeholder, 
  onChange, 
  onBlur,
  className,
  isTextarea = false,
  inputMode
}: { 
  id: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  onBlur?: () => void
  className?: string
  isTextarea?: boolean
  inputMode?: string
}) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  
  // Only update DOM value when prop changes externally (not from our own onChange)
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.value = value
    }
  }, [value, id])
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!isComposingRef.current) {
      onChange(e.target.value)
    }
  }
  
  const handleCompositionStart = () => {
    isComposingRef.current = true
  }
  
  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    isComposingRef.current = false
    onChange((e.target as HTMLInputElement | HTMLTextAreaElement).value)
  }
  
  if (isTextarea) {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        id={id}
        className={className}
        placeholder={placeholder}
        defaultValue={value}
        onChange={handleChange}
        onBlur={onBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    )
  }
  
  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      id={id}
      className={className}
      placeholder={placeholder}
      defaultValue={value}
      onChange={handleChange}
      onBlur={onBlur}
      inputMode={inputMode as any}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  )
})

LoreInput.displayName = 'LoreInput'

type Props = {
  open: boolean
  onClose: () => void
  personaIndex: number
  persona: any
  onChange: (updated: any) => void
}

// (debug component removed)

const CharacterSidePanel = React.memo(({ open, onClose, personaIndex, persona, onChange }: Props) => {
  const [rooms, setRooms] = useState<Array<{ id: string, name: string }>>([])
  const [activeRoomId, setActiveRoomIdLocal] = useState<string>('')
  const [leftOffset, setLeftOffset] = useState<number>(0)
  const asideRef = useRef<HTMLElement | null>(null)

  // Local editable states sourced from persona.characterData (Risu CCv3)
  const v3 = useMemo(()=>{
    const cd = persona?.characterData
    if (cd?.spec === 'chara_card_v3' && cd?.data) return cd
    // Build a minimal v3 skeleton if missing
    return {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: persona?.name || '',
        description: persona?.description || '',
        personality: '',
        scenario: '',
        first_mes: '',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: { scan_depth: 0, token_budget: 0, recursive_scanning: false, extensions: {}, entries: [] },
        tags: [],
        creator: '',
        character_version: '1',
        extensions: { risuai: { customScripts: [] }, depth_prompt: undefined },
        group_only_greetings: [], nickname: '', source: [], creation_date: 0, modification_date: 0,
        assets: []
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona?.characterData, persona?.name, persona?.description])

  const [cardName, setCardName] = useState<string>(v3.data.name || '')
  const [cardDesc, setCardDesc] = useState<string>(v3.data.description || '')
  const [globalOverride, setGlobalOverride] = useState<string>(v3.data.post_history_instructions || '')
  
  // Use ref for drafts to avoid re-renders
  const cardDraftsRef = useRef({
    name: v3.data.name || '',
    desc: v3.data.description || '',
    globalOverride: v3.data.post_history_instructions || ''
  })
  
  // Use ref for card draft handlers to avoid re-creating
  const cardDraftHandlersRef = useRef({
    name: (val: string) => {
      cardDraftsRef.current.name = val
    },
    desc: (val: string) => {
      cardDraftsRef.current.desc = val
    },
    globalOverride: (val: string) => {
      cardDraftsRef.current.globalOverride = val
    }
  })
  
  const cardDraftHandlers = cardDraftHandlersRef.current
  
  // Commit card drafts to actual state on blur
  const commitCardDraft = useCallback((field: 'name' | 'desc' | 'globalOverride') => {
    if (field === 'name') setCardName(cardDraftsRef.current.name)
    else if (field === 'desc') setCardDesc(cardDraftsRef.current.desc)
    else if (field === 'globalOverride') setGlobalOverride(cardDraftsRef.current.globalOverride)
  }, [])
  
  const [loreEntries, setLoreEntries] = useState<any[]>(() => {
    const raw = Array.isArray(v3.data?.character_book?.entries) ? v3.data.character_book.entries : []
    return raw.map((e:any, i:number) => ({ _lid: crypto?.randomUUID ? crypto.randomUUID() : `l-${Date.now()}-${i}`, _io: typeof e?.insertion_order === 'number' ? String(e.insertion_order) : '', ...e }))
  })
  const [scripts, setScripts] = useState<RegexScript[]>(() => {
    const raw = Array.isArray(v3.data?.extensions?.risuai?.customScripts) ? v3.data.extensions.risuai.customScripts : []
    return raw.map((e:any, i:number) => ({ id: e?.id || (crypto?.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${i}`), name: e?.name || e?.title || '', type: e?.type, in: e?.in || e?.regex_in || '', out: e?.out || e?.regex_out || '', flags: e?.flags || 'g', enabled: e?.enabled !== false }))
  })
  const [openLoreIdx, setOpenLoreIdx] = useState<Record<string, boolean>>({})
  const [openScriptIdx, setOpenScriptIdx] = useState<Record<string, boolean>>({})

  const shouldHideLoreEntry = useCallback((entry: any) => {
    if (!entry) return false
    const keys = entry.keys
    if (Array.isArray(keys)) {
      return keys.some((k: any) => typeof k === 'string' && k.toLowerCase().includes('folder'))
    }
    if (typeof keys === 'string') {
      return keys.toLowerCase().includes('folder')
    }
    return false
  }, [])

  const visibleLoreEntries = useMemo(() => {
    return loreEntries
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .filter(({ entry }) => !shouldHideLoreEntry(entry))
  }, [loreEntries, shouldHideLoreEntry])

  const hiddenLoreCount = loreEntries.length - visibleLoreEntries.length

  const patchLoreEntry = useCallback((index: number, patch: Partial<any> | ((entry: any) => any)) => {
    setLoreEntries(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const current = prev[index] ?? {}
      const nextEntry = typeof patch === 'function' ? (patch as (entry: any) => any)(current) : { ...current, ...patch }
      if (nextEntry === current) return prev
      const clone = prev.slice()
      clone[index] = nextEntry
      return clone
    })
  }, [])

  const removeLoreEntry = useCallback((index: number, key: string) => {
    setLoreEntries(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const clone = prev.slice()
      clone.splice(index, 1)
      return clone
    })
    setOpenLoreIdx(prev => {
      if (!prev || !(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const patchScript = useCallback((index: number, patch: Partial<RegexScript> | ((entry: RegexScript) => RegexScript)) => {
    setScripts(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const current = prev[index] ?? {} as RegexScript
      const nextEntry = typeof patch === 'function' ? (patch as (entry: RegexScript) => RegexScript)(current as RegexScript) : { ...current, ...patch }
      if (nextEntry === current) return prev
      const clone = prev.slice()
      clone[index] = nextEntry
      return clone
    })
  }, [])

  const removeScript = useCallback((index: number, key: string) => {
    setScripts(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const clone = prev.slice()
      clone.splice(index, 1)
      return clone
    })
    setOpenScriptIdx(prev => {
      if (!prev || !(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  // Commit draft to actual state
  const commitLoreDraft = useCallback((key: string, index: number) => {
    const draft = loreDraftsRef.current[key]
    if (!draft) return
    
    setLoreEntries(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const current = prev[index] ?? {}
      const clone = prev.slice()
      clone[index] = {
        ...current,
        name: draft.name,
        _io: draft.order,
        keys: draft.keys.split(',').map((s: string) => s.trim()).filter(Boolean),
        content: draft.content
      }
      return clone
    })
  }, [])

  const commitScriptDraft = useCallback((key: string, index: number) => {
    const draft = scriptDraftsRef.current[key]
    if (!draft) return
    
    setScripts(prev => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const current = prev[index] ?? {} as RegexScript
      const clone = prev.slice()
      clone[index] = {
        ...current,
        name: draft.name,
        in: draft.in,
        flags: draft.flags,
        out: draft.out
      }
      return clone
    })
  }, [])

  // Use ref for lore/script draft handlers to avoid re-creating
  const loreDraftsRef = useRef<Record<string, LoreDraft>>({})
  const scriptDraftsRef = useRef<Record<string, ScriptDraft>>({})
  
  // Initialize refs from state
  useEffect(() => {
    loreEntries.forEach((entry, idx) => {
      const key = String(entry?._lid || idx)
      if (!loreDraftsRef.current[key]) {
        loreDraftsRef.current[key] = {
          name: entry.name || '',
          order: entry._io || '',
          keys: Array.isArray(entry.keys) ? entry.keys.join(', ') : (entry.keys || ''),
          content: entry.content || ''
        }
      }
    })
  }, [loreEntries.length])
  
  useEffect(() => {
    scripts.forEach((script, idx) => {
      const key = String(script?.id || idx)
      if (!scriptDraftsRef.current[key]) {
        scriptDraftsRef.current[key] = {
          name: script.name || '',
          in: script.in || '',
          flags: script.flags || 'g',
          out: script.out || ''
        }
      }
    })
  }, [scripts.length])

  // Create stable handler refs
  const loreDraftHandlersRef = useRef<Record<string, Record<string, (val: string) => void>>>({})
  const scriptDraftHandlersRef = useRef<Record<string, Record<string, (val: string) => void>>>({})
  
  // Initialize handlers once per entry
  loreEntries.forEach((entry, idx) => {
    const entryKey = String(entry?._lid || idx)
    if (!loreDraftHandlersRef.current[entryKey]) {
      loreDraftHandlersRef.current[entryKey] = {
        name: (val: string) => {
          loreDraftsRef.current[entryKey] = { ...loreDraftsRef.current[entryKey], name: val }
        },
        order: (val: string) => {
          loreDraftsRef.current[entryKey] = { ...loreDraftsRef.current[entryKey], order: val }
        },
        keys: (val: string) => {
          loreDraftsRef.current[entryKey] = { ...loreDraftsRef.current[entryKey], keys: val }
        },
        content: (val: string) => {
          loreDraftsRef.current[entryKey] = { ...loreDraftsRef.current[entryKey], content: val }
        }
      }
    }
  })
  
  scripts.forEach((script, idx) => {
    const scriptKey = String(script?.id || idx)
    if (!scriptDraftHandlersRef.current[scriptKey]) {
      scriptDraftHandlersRef.current[scriptKey] = {
        name: (val: string) => {
          scriptDraftsRef.current[scriptKey] = { ...scriptDraftsRef.current[scriptKey], name: val }
        },
        in: (val: string) => {
          scriptDraftsRef.current[scriptKey] = { ...scriptDraftsRef.current[scriptKey], in: val }
        },
        flags: (val: string) => {
          scriptDraftsRef.current[scriptKey] = { ...scriptDraftsRef.current[scriptKey], flags: val }
        },
        out: (val: string) => {
          scriptDraftsRef.current[scriptKey] = { ...scriptDraftsRef.current[scriptKey], out: val }
        }
      }
    }
  })
  
  const loreDraftHandlers = loreDraftHandlersRef.current
  const scriptDraftHandlers = scriptDraftHandlersRef.current

  useEffect(()=>{
    (async ()=>{
      const list = await getChatRooms(personaIndex)
      setRooms(Array.isArray(list) ? list : [])
      const active = await getActiveChatRoom(personaIndex)
      setActiveRoomIdLocal(active || '')
    })()
  }, [personaIndex])

  // Measure sidebar width to align panel flush to its left edge
  useLayoutEffect(() => {
    const aside = document.querySelector('aside.sidebar') as HTMLElement | null
    asideRef.current = aside
    const measure = () => {
      const w = aside ? aside.getBoundingClientRect().width : 0
      setLeftOffset(Math.max(0, Math.round(w)))
    }
    // Observe size changes for immediate updates
    let ro: ResizeObserver | null = null
    if (aside && 'ResizeObserver' in window) {
      ro = new ResizeObserver(() => measure())
      ro.observe(aside)
    }
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (ro && aside) ro.disconnect()
    }
  }, [])

  function emitRoomChange(roomId: string){
    // Save active
    setActiveChatRoom(personaIndex, roomId)
    setActiveRoomIdLocal(roomId)
    // Notify Chat component
    const evt = new CustomEvent('chatRoomChanged', { detail: { roomId } })
    window.dispatchEvent(evt)
  }

  const addRoom = async () => {
    const id = `room-${Date.now()}`
    const name = `채팅 ${rooms.length + 1}`
    const updated = [...rooms, { id, name }]
    setRooms(updated)
    await setChatRooms(personaIndex, updated)
    emitRoomChange(id)
  }
  const renameRoom = async (id: string, name: string) => {
    const updated = rooms.map(r=> r.id===id ? { ...r, name } : r)
    setRooms(updated)
    await setChatRooms(personaIndex, updated)
  }
  const removeRoom = async (id: string) => {
    const updated = rooms.filter(r=>r.id!==id)
    setRooms(updated)
    await setChatRooms(personaIndex, updated)
    if (activeRoomId === id) {
      const fallback = updated[0]?.id || 'default'
      emitRoomChange(fallback)
    }
  }

  const saveAll = () => {
    // Commit all drafts from refs before saving
    const finalCardName = cardDraftsRef.current.name
    const finalCardDesc = cardDraftsRef.current.desc
    const finalGlobalOverride = cardDraftsRef.current.globalOverride
    
    // Update states with draft values
    setCardName(finalCardName)
    setCardDesc(finalCardDesc)
    setGlobalOverride(finalGlobalOverride)
    
    // Commit all lore drafts
    loreEntries.forEach((entry, idx) => {
      const key = String(entry?._lid || idx)
      const draft = loreDraftsRef.current[key]
      if (draft) {
        commitLoreDraft(key, idx)
      }
    })
    
    // Commit all script drafts
    scripts.forEach((script, idx) => {
      const key = String(script?.id || idx)
      const draft = scriptDraftsRef.current[key]
      if (draft) {
        commitScriptDraft(key, idx)
      }
    })
    
    // Use setTimeout to ensure state updates are processed
    setTimeout(() => {
      const next = {
        ...persona,
        name: finalCardName,
        description: finalCardDesc,
        characterData: {
          ...v3,
          data: {
            ...v3.data,
            name: finalCardName,
            description: finalCardDesc,
            post_history_instructions: finalGlobalOverride,
            character_book: {
              ...(v3.data.character_book||{}),
              entries: loreEntries.map(({ _lid, _io, ...rest }: any) => ({ ...rest, insertion_order: Number(_io ?? rest.insertion_order ?? 0) || 0 }))
            },
            extensions: {
              ...(v3.data.extensions||{}),
              risuai: {
                ...((v3.data.extensions||{}).risuai||{}),
                customScripts: scripts.map((s:any) => ({ id: s.id, name: s.name, type: s.type, in: s.in, out: s.out, flags: s.flags, enabled: s.enabled }))
              }
            }
          }
        }
      }
      onChange(next)
    }, 0)
  }

  // UI helpers
  const PanelWrapper = ({ children }: {children: React.ReactNode}) => (
    <div 
      className="fixed top-0 right-0 bottom-0 z-50"
      style={{ width: `calc(100vw - ${leftOffset}px)`, display: open ? 'block' : 'none' }}
    >
      <div className="h-full bg-slate-900/95 border-l border-slate-700/50 shadow-2xl backdrop-blur-xl p-6 overflow-auto">
        {children}
      </div>
    </div>
  )

  return (
    <>
      {/* overlay */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" 
        style={{ display: open ? 'block' : 'none' }}
        onClick={onClose} 
      />
      <PanelWrapper>
        <div className="flex items-center justify-between mb-6">
          <div className="text-slate-400 text-sm">캐릭터 편집</div>
          <div className="flex gap-2">
            <button onClick={saveAll} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold">저장</button>
            <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700/70 hover:bg-slate-600/70 text-slate-200">닫기</button>
          </div>
        </div>

        {/* 4-column layout always visible with separators */}
        <div className="grid [grid-template-columns:1fr_auto_1fr_auto_1fr_auto_1fr] gap-6">
          {/* 1. Sessions */}
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-300 text-center">채팅방</div>
            <div className="text-xs font-bold text-slate-300 flex items-center gap-2"><IconCog className="w-4 h-4 text-teal-400" /> 채팅방 정보</div>
            <div className="space-y-2">
              {rooms.map(r=> (
                <div key={r.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${activeRoomId===r.id? 'border-teal-500/60 bg-slate-800/60':'border-slate-700/50 bg-slate-900/40'}`}>
                  <label htmlFor={`room-name-${r.id}`} className="sr-only">채팅방 이름</label>
                  <input id={`room-name-${r.id}`} name={`room-name-${r.id}`} aria-label="채팅방 이름" className="flex-1 bg-transparent outline-none text-slate-100" value={r.name} onChange={e=>renameRoom(r.id, e.target.value)} />
                  <button onClick={()=>emitRoomChange(r.id)} className={`px-2 py-1 text-xs rounded ${activeRoomId===r.id? 'bg-teal-600 text-white':'bg-slate-700/70 text-slate-200 hover:bg-slate-600/70'}`}>활성화</button>
                  <button onClick={()=>removeRoom(r.id)} className="p-1 text-slate-300 hover:text-red-400"><IconTrash className="w-4 h-4"/></button>
                </div>
              ))}
              <button onClick={addRoom} className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200">+ 새 채팅</button>
            </div>
          </div>

          {/* Separator */}
          <div className="h-full flex items-stretch justify-center"><div className="w-px bg-slate-700/50" aria-hidden="true" /></div>

          {/* 2. Card Info */}
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-300 text-center">카드</div>
            <div className="text-xs font-bold text-slate-300 flex items-center gap-2"><IconNote className="w-4 h-4 text-cyan-400" /> 캐릭터카드 정보</div>
            <div>
              <label htmlFor="card-name" className="block text-xs text-slate-400 mb-1">이름 {'{{char}}'}</label>
              <LoreInput
                id="card-name"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2"
                value={cardName}
                onChange={cardDraftHandlers.name}
                onBlur={() => commitCardDraft('name')}
              />
            </div>
            <div>
              <label htmlFor="card-desc" className="block text-xs text-slate-400 mb-1">설명 {'{{char_description}}'}</label>
              <LoreInput
                id="card-desc"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[160px]"
                value={cardDesc}
                onChange={cardDraftHandlers.desc}
                onBlur={() => commitCardDraft('desc')}
                isTextarea
              />
            </div>
            <div>
              <label htmlFor="card-global-override" className="block text-xs text-slate-400 mb-1">글로벌 노트 덮어쓰기 (post_history_instructions)</label>
              <LoreInput
                id="card-global-override"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[120px]"
                value={globalOverride}
                onChange={cardDraftHandlers.globalOverride}
                onBlur={() => commitCardDraft('globalOverride')}
                isTextarea
              />
            </div>
          </div>

          {/* Separator */}
          <div className="h-full flex items-stretch justify-center"><div className="w-px bg-slate-700/50" aria-hidden="true" /></div>

          {/* 3. Lorebook (flat list, no folders) */}
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-300 text-center">로어북</div>
            {hiddenLoreCount > 0 && (
              <div className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700/50 rounded-lg px-3 py-2">
                folder 키가 포함된 항목 {hiddenLoreCount}개는 편집 목록에서 숨겨졌습니다.
              </div>
            )}
            <div className="space-y-3">
              {visibleLoreEntries.map(({ entry, originalIndex }, visibleIndex) => {
                const entryKey = String(entry?._lid || originalIndex)
                const rowOpen = openLoreIdx[entryKey] === true
                const title = entry.name || entry.comment || `항목 ${visibleIndex+1}`
                const draft = loreDraftsRef.current[entryKey] || { name: entry.name || '', order: entry._io || '', keys: Array.isArray(entry.keys) ? entry.keys.join(', ') : (entry.keys || ''), content: entry.content || '' }
                
                return (
                  <div key={entryKey} className="rounded-lg border border-slate-700/50 bg-slate-900/40">
                    <button className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-slate-800/50" onClick={() => setOpenLoreIdx(prev => ({ ...prev, [entryKey]: !rowOpen }))}>
                      <div className="flex items-center gap-2 text-slate-200">
                        <svg className={`w-3.5 h-3.5 transition-transform ${rowOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
                        <span className="font-medium truncate max-w-[200px]" title={title}>{title}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-300">
                        <span>배치 {entry.insertion_order ?? 0}</span>
                        {entry.constant ? <span className="text-teal-400">상시</span> : null}
                        {entry.use_regex ? <span className="text-cyan-400">정규식</span> : null}
                      </div>
                    </button>
                    {rowOpen && (
                      <div className="px-3 py-3 space-y-2">
                          <div className="flex gap-2">
                            <label htmlFor={`lore-name-${entry._lid||originalIndex}`} className="sr-only">로어 이름</label>
                            <LoreInput
                              id={`lore-name-${entry._lid||originalIndex}`} 
                              className="flex-1 rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                              placeholder="이름" 
                              value={draft.name}
                              onChange={loreDraftHandlers[entryKey]?.name}
                              onBlur={() => {
                                console.log('[Draft onBlur] lore-name', entryKey)
                                commitLoreDraft(entryKey, originalIndex)
                              }}
                            />
                            <label htmlFor={`lore-order-${entry._lid||originalIndex}`} className="sr-only">배치</label>
                            <LoreInput
                              id={`lore-order-${entry._lid||originalIndex}`} 
                              className="w-24 rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                              placeholder="배치" 
                              inputMode="numeric" 
                              value={draft.order}
                              onChange={loreDraftHandlers[entryKey]?.order}
                              onBlur={() => commitLoreDraft(entryKey, originalIndex)}
                            />
                          </div>
                          <label htmlFor={`lore-keys-${entry._lid||originalIndex}`} className="sr-only">활성화 키</label>
                          <LoreInput
                            id={`lore-keys-${entry._lid||originalIndex}`} 
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                            placeholder="활성화 키 (쉼표로 구분)" 
                            value={draft.keys}
                            onChange={loreDraftHandlers[entryKey]?.keys}
                            onBlur={() => commitLoreDraft(entryKey, originalIndex)}
                          />
                      <div className="flex items-center gap-3 text-xs text-slate-300">
                        <label htmlFor={`lore-selective-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-selective-${entry._lid||originalIndex}`} name={`lore-selective-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.selective} onChange={e=>patchLoreEntry(originalIndex, { selective: e.target.checked })} /> 멀티키(모두 충족)</label>
                        <label htmlFor={`lore-constant-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-constant-${entry._lid||originalIndex}`} name={`lore-constant-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.constant} onChange={e=>patchLoreEntry(originalIndex, { constant: e.target.checked })} /> 언제나 활성화</label>
                        <label htmlFor={`lore-useregex-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-useregex-${entry._lid||originalIndex}`} name={`lore-useregex-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.use_regex} onChange={e=>patchLoreEntry(originalIndex, { use_regex: e.target.checked })} /> 정규식</label>
                      </div>
                          <label htmlFor={`lore-content-${entry._lid||originalIndex}`} className="sr-only">내용</label>
                          <LoreInput
                            id={`lore-content-${entry._lid||originalIndex}`} 
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 min-h-[120px]" 
                            placeholder="content" 
                            value={draft.content}
                            onChange={loreDraftHandlers[entryKey]?.content}
                            onBlur={() => commitLoreDraft(entryKey, originalIndex)}
                            isTextarea
                          />
                          <div className="flex justify-end"><button className="text-red-400 text-sm" onClick={()=>removeLoreEntry(originalIndex, entryKey)}>삭제</button></div>
                      </div>
                    )}
                  </div>
                )
              })}
              <button className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" onClick={()=> {
                const _lid = (crypto?.randomUUID ? crypto.randomUUID() : `l-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                const nextItem = { _lid, keys: [], content: '', insertion_order: 0, enabled: true }
                setLoreEntries(prev => ([...(prev||[]), nextItem]))
                const key = String(_lid)
                setOpenLoreIdx(prev => ({ ...prev, [key]: true }))
              }}>+ 항목 추가</button>
            </div>
          </div>

          {/* Separator */}
          <div className="h-full flex items-stretch justify-center"><div className="w-px bg-slate-700/50" aria-hidden="true" /></div>

          {/* 4. Scripts */}
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-300 text-center">스크립트</div>
            <div className="text-xs font-bold text-slate-300">정규식 스크립트</div>
            <div className="space-y-2">
              {scripts.map((sc, idx)=> {
                const scriptKey = String(sc?.id || idx)
                const rowOpen = openScriptIdx[scriptKey] === true
                const draft = scriptDraftsRef.current[scriptKey] || { name: sc.name || '', in: sc.in || '', flags: sc.flags || 'g', out: sc.out || '' }
                
                return (
                  <div key={scriptKey} className="rounded-xl border border-slate-700/50 bg-slate-900/40">
                    <button className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/50" onClick={() => setOpenScriptIdx(prev => ({ ...prev, [scriptKey]: !rowOpen }))}>
                      <div className="flex items-center gap-2 text-slate-200">
                        <svg className={`w-3.5 h-3.5 transition-transform ${rowOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
                        <span className="font-medium truncate max-w-[200px]" title={sc.name || sc.in || `스크립트 ${idx+1}`}>{sc.name || sc.in || `스크립트 ${idx+1}`}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-300">
                        <span>{sc.type || 'display'}</span>
                        {sc.enabled!==false ? <span className="text-teal-400">on</span> : <span className="text-slate-500">off</span>}
                      </div>
                    </button>
                    {rowOpen && (
                      <div className="px-3 py-3 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <label htmlFor={`script-name-${sc.id||idx}`} className="sr-only">스크립트 이름</label>
                            <LoreInput
                              id={`script-name-${sc.id||idx}`} 
                              className="rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                              placeholder="이름" 
                              value={draft.name}
                              onChange={scriptDraftHandlers[scriptKey]?.name}
                              onBlur={() => commitScriptDraft(scriptKey, idx)}
                            />
                            <label htmlFor={`script-type-${sc.id||idx}`} className="sr-only">스크립트 타입</label>
                            <select 
                              id={`script-type-${sc.id||idx}`} 
                              className="rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                              value={sc.type||'display'} 
                              onChange={e=>patchScript(idx, { type: e.target.value as any })}
                            >
                              <option value="input">입력문수정</option>
                              <option value="output">출력문수정</option>
                              <option value="request">리퀘스트 데이터 수정</option>
                              <option value="display">디스플레이 수정</option>
                              <option value="disabled">비활성화</option>
                            </select>
                          </div>
                          <label htmlFor={`script-in-${sc.id||idx}`} className="sr-only">정규식 IN</label>
                          <LoreInput
                            id={`script-in-${sc.id||idx}`} 
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                            placeholder="IN (정규식)" 
                            value={draft.in}
                            onChange={scriptDraftHandlers[scriptKey]?.in}
                            onBlur={() => commitScriptDraft(scriptKey, idx)}
                          />
                          <label htmlFor={`script-flags-${sc.id||idx}`} className="sr-only">플래그</label>
                          <LoreInput
                            id={`script-flags-${sc.id||idx}`} 
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1" 
                            placeholder="플래그 (예: gmi)" 
                            value={draft.flags}
                            onChange={scriptDraftHandlers[scriptKey]?.flags}
                            onBlur={() => commitScriptDraft(scriptKey, idx)}
                          />
                          <label htmlFor={`script-out-${sc.id||idx}`} className="sr-only">OUT 템플릿</label>
                          <LoreInput
                            id={`script-out-${sc.id||idx}`} 
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 min-h-[100px]" 
                            placeholder="OUT ($1, $2, $& 사용 가능)" 
                            value={draft.out}
                            onChange={scriptDraftHandlers[scriptKey]?.out}
                            onBlur={() => commitScriptDraft(scriptKey, idx)}
                            isTextarea
                          />
                          <div className="flex items-center justify-between">
                            <label htmlFor={`script-enabled-${sc.id||idx}`} className="text-xs text-slate-300 flex items-center gap-2">
                              <input 
                                id={`script-enabled-${sc.id||idx}`} 
                                type="checkbox" 
                                checked={sc.enabled!==false} 
                                onChange={e=>patchScript(idx, { enabled: e.target.checked })} 
                              /> 활성화
                            </label>
                            <button className="text-red-400 text-sm" onClick={()=>removeScript(idx, scriptKey)}>삭제</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              <button className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" onClick={()=> {
                const id = (crypto?.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                const newItem: RegexScript = { id, name: '', type: 'display', in: '', out: '', flags: 'g', enabled: true }
                setScripts(prev => ([...(prev||[]), newItem]))
                const key = String(id)
                setOpenScriptIdx(prev => ({ ...prev, [key]: true }))
              }}>+ 스크립트 추가</button>
            </div>
          </div>
        </div>
      </PanelWrapper>
    </>
  )
})

CharacterSidePanel.displayName = 'CharacterSidePanel'

export default CharacterSidePanel
