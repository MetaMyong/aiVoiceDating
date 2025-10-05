import React, { useEffect, useMemo, useState, useLayoutEffect, useRef, useCallback } from 'react'
import { getChatRooms, setChatRooms, getActiveChatRoom, setActiveChatRoom, getRoomAuthorNotes, setRoomAuthorNotes } from '../lib/indexeddb'
import { IconTrash, IconCog, IconNote } from './Icons'
import SmartInput from './inputs/SmartInput'
import SmartTextarea from './inputs/SmartTextarea'

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

type RoomDraft = {
  name: string
}

// Using SmartInput/SmartTextarea for all editable fields

type Props = {
  open: boolean
  onClose: () => void
  personaIndex: number
  persona: any
  onChange: (updated: any) => void
}

// (debug component removed)

const CharacterSidePanel = React.memo(({ open, onClose, personaIndex, persona, onChange }: Props) => {
  const dbg = (...args: any[]) => { try { if (typeof window !== 'undefined' && (window as any).__CSP_DEBUG) { console.log('[CSP]', ...args) } } catch {} }
  const [rooms, setRooms] = useState<Array<{ id: string, name: string }>>([])
  const [activeRoomId, setActiveRoomIdLocal] = useState<string>('default')
  const [leftOffset, setLeftOffset] = useState<number>(0)
  const asideRef = useRef<HTMLElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const moRef = useRef<MutationObserver | null>(null)
  const [isMdUp, setIsMdUp] = useState<boolean>(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)').matches : true)

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
  const [characterTTSProvider, setCharacterTTSProvider] = useState<string>(v3.data.extensions?.characterTTS?.provider || 'none')
  const [characterTTSModel, setCharacterTTSModel] = useState<string>(v3.data.extensions?.characterTTS?.model || '')
  const [characterTTSVoice, setCharacterTTSVoice] = useState<string>(v3.data.extensions?.characterTTS?.voice || 'Zephyr')
  const [authorNotes, setAuthorNotes] = useState<string>('')
  
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
  
  // Commit card drafts on blur: no-op to avoid re-render on blur (state sync happens on Save)
  const commitCardDraft = useCallback((_field: 'name' | 'desc' | 'globalOverride') => {
    // intentionally no setState here
  }, [])

  // Author notes (per-room). Keep a separate draft to mirror existing pattern
  const authorNotesDraftRef = useRef<string>('')
  const commitAuthorNotesDraft = useCallback(async () => {
    const text = authorNotesDraftRef.current
    const rid = activeRoomId || 'default'
    // Persist quietly without triggering re-render to avoid first-click loss
    ;(async () => { try { await setRoomAuthorNotes(rid, text) } catch {} })()
    try {
      const evt = new CustomEvent('authorNotesChanged', { detail: { roomId: rid, notes: text } })
      window.dispatchEvent(evt)
    } catch {}
  }, [activeRoomId])
  
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
  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<'rooms'|'card'|'lore'|'scripts'>('rooms')
  
  // Room drafts for each room by ID
  const roomDraftsRef = useRef<Record<string, RoomDraft>>({})
  const roomDraftHandlersRef = useRef<Record<string, { name: (val: string) => void }>>({})

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

  // Commit lore draft on blur: no-op to avoid re-render; Save merges drafts
  const commitLoreDraft = useCallback((_key: string, _index: number) => {
    // intentionally no setState here
  }, [])

  const commitRoomDraft = useCallback((_roomId: string) => {
    // intentionally no setState here; Save will persist room names
  }, [])

  const commitScriptDraft = useCallback((_key: string, _index: number) => {
    // intentionally no setState here; Save merges drafts
  }, [])

  // Capture currently active input/textarea value into draft refs (before blur)
  const captureActiveElementDraft = useCallback(() => {
    try {
      const ae = document.activeElement as any
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        const id = String(ae.id || '')
        const val = String(ae.value ?? '')
        try { const w:any = window as any; if (w && w.__CSP_DEBUG) { console.log('[CSP] captureActiveElementDraft', { id, len: (val||'').length }) } } catch {}
        if (id) {
          if (id === 'card-name' || id === 'm-card-name') {
            cardDraftsRef.current.name = val
          } else if (id === 'card-desc' || id === 'm-card-desc') {
            cardDraftsRef.current.desc = val
          } else if (id === 'card-global-override' || id === 'm-card-go') {
            cardDraftsRef.current.globalOverride = val
          } else if (id === 'card-author-notes' || id === 'm-author-notes') {
            authorNotesDraftRef.current = val
          } else if (id.startsWith('room-name-') || id.startsWith('m-room-name-')) {
            const rid = id.replace(/^m?-?room-name-/, '')
            if (!roomDraftsRef.current[rid]) roomDraftsRef.current[rid] = { name: '' }
            roomDraftsRef.current[rid].name = val
          } else if (/^lore-(name|order|keys|content)-/.test(id)) {
            const match = id.match(/^lore-(name|order|keys|content)-/)
            const field = match && match[1]
            const key = id.replace(/^lore-(name|order|keys|content)-/, '')
            if (!loreDraftsRef.current[key]) loreDraftsRef.current[key] = { name: '', order: '', keys: '', content: '' }
            if (field) (loreDraftsRef.current[key] as any)[field] = val
          } else if (/^script-(name|in|flags|out)-/.test(id)) {
            const match = id.match(/^script-(name|in|flags|out)-/)
            const field = match && match[1]
            const key = id.replace(/^script-(name|in|flags|out)-/, '')
            if (!scriptDraftsRef.current[key]) scriptDraftsRef.current[key] = { name: '', in: '', flags: 'g', out: '' }
            if (field) (scriptDraftsRef.current[key] as any)[field] = val
          }
        }
      }
    } catch {}
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
      const rid0 = active || 'default'
      setActiveRoomIdLocal(rid0)
      // Load author notes for the active room
      try { const an = await getRoomAuthorNotes(rid0); setAuthorNotes(an || ''); authorNotesDraftRef.current = an || '' } catch {}
    })()
  }, [personaIndex])
  
  // Initialize room draft handlers when rooms change
  useEffect(() => {
    rooms.forEach(room => {
      const roomId = room.id
      if (!roomDraftsRef.current[roomId]) {
        roomDraftsRef.current[roomId] = { name: room.name }
      }
      if (!roomDraftHandlersRef.current[roomId]) {
        roomDraftHandlersRef.current[roomId] = {
          name: (val: string) => {
            roomDraftsRef.current[roomId] = { ...roomDraftsRef.current[roomId], name: val }
          }
        }
      }
    })
  }, [rooms])
  
  const roomDraftHandlers = roomDraftHandlersRef.current

  // Track breakpoint and dynamically measure the current sidebar element (desktop or mobile overlay)
  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handleMQ = () => setIsMdUp(mq.matches)
    handleMQ()
    mq.addEventListener?.('change', handleMQ)

    const measure = (el: HTMLElement | null) => {
      const w = el ? el.getBoundingClientRect().width : 0
      setLeftOffset(Math.max(0, Math.round(w)))
    }

    const attachToCurrentAside = () => {
      // Breakpoint별 사이드바 선택: 데스크톱은 .sidebar-desktop, 모바일 오버레이에서는 .sidebar-mobile
      const selector = isMdUp ? 'aside.sidebar.sidebar-desktop' : 'aside.sidebar.sidebar-mobile'
      const currentAside = document.querySelector(selector) as HTMLElement | null
      if (currentAside !== asideRef.current) {
        // Detach old observer
        if (roRef.current && asideRef.current) {
          try { roRef.current.unobserve(asideRef.current) } catch {}
        }
        asideRef.current = currentAside
        // Attach new observer
        if (currentAside && 'ResizeObserver' in window) {
          if (!roRef.current) {
            roRef.current = new ResizeObserver(() => measure(asideRef.current))
          }
          try { roRef.current.observe(currentAside) } catch {}
        }
      }
      measure(currentAside)
    }

    // Initial attach
    attachToCurrentAside()
    const onResize = () => attachToCurrentAside()
    window.addEventListener('resize', onResize)

    // Observe DOM changes to swap between mobile overlay sidebar and desktop sidebar
    if ('MutationObserver' in window) {
      moRef.current = new MutationObserver(() => {
        // Debounce slightly
        requestAnimationFrame(attachToCurrentAside)
      })
      try {
        moRef.current.observe(document.body, { childList: true, subtree: true })
      } catch {}
    }

    return () => {
      window.removeEventListener('resize', onResize)
      mq.removeEventListener?.('change', handleMQ)
      if (roRef.current && asideRef.current) {
        try { roRef.current.unobserve(asideRef.current) } catch {}
      }
      roRef.current = null
      if (moRef.current) {
        try { moRef.current.disconnect() } catch {}
      }
      moRef.current = null
    }
  }, [])

  // While the editor is open, capture active input draft on any mousedown to avoid losing pre-blur keystrokes
  useEffect(() => {
    if (!open) return
    const onAnyMouseDown = (e: MouseEvent) => {
      try {
        const t = e.target as HTMLElement
        const ae = document.activeElement as HTMLElement | null
        dbg('mousedown(capture)', { target: t?.tagName, targetId: (t as any)?.id, activeBefore: ae?.tagName, activeId: (ae as any)?.id })
      } catch {}
      captureActiveElementDraft()
    }
    window.addEventListener('mousedown', onAnyMouseDown, true) // capture phase
    return () => {
      window.removeEventListener('mousedown', onAnyMouseDown, true)
    }
  }, [open, captureActiveElementDraft])

  function emitRoomChange(roomId: string){
    // Save active
    setActiveChatRoom(personaIndex, roomId)
    setActiveRoomIdLocal(roomId)
    // Notify Chat component
    const evt = new CustomEvent('chatRoomChanged', { detail: { roomId } })
    window.dispatchEvent(evt)
    // Load author notes for new room
    ;(async ()=>{
      try { const an = await getRoomAuthorNotes(roomId); setAuthorNotes(an || ''); authorNotesDraftRef.current = an || '' } catch {}
    })()
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
    try { const w:any = window as any; if (w && w.__CSP_DEBUG) { console.log('[CSP] saveAll:start') } } catch {}
    // 0) Capture active element's value (pre-blur) just like Settings
    captureActiveElementDraft()

    // 1) 최종 카드 텍스트 값은 draft refs에서 직접 읽어 최신값 보장
    const finalCardName = cardDraftsRef.current.name
    const finalCardDesc = cardDraftsRef.current.desc
    const finalGlobalOverride = cardDraftsRef.current.globalOverride

    // UI 상태 업데이트는 저장 직후 한 번만(지연) 적용
    setTimeout(() => {
      setCardName(finalCardName)
      setCardDesc(finalCardDesc)
      setGlobalOverride(finalGlobalOverride)
      try { const w:any = window as any; if (w && w.__CSP_DEBUG) { console.log('[CSP] saveAll:syncUI', { finalCardNameLen: (finalCardName||'').length, finalCardDescLen: (finalCardDesc||'').length }) } } catch {}
    }, 0)

    // 2) 채팅방: draft를 이용해 최종 목록 구성 후 일괄 저장
    const finalRooms = rooms.map((room) => {
      const draft = roomDraftsRef.current[room.id]
      return draft ? { ...room, name: draft.name } : room
    })
    // 비동기로 저장, UI는 다음 tick에 반영됨
    try { setChatRooms(personaIndex, finalRooms).catch(()=>{}) } catch {}

    // 3) 로어/스크립트는 setState 타이밍을 기다리지 않고 draft refs와 현재 state를 병합해 최종 데이터 구성
    const finalLoreEntries = loreEntries.map((entry, idx) => {
      const key = String(entry?._lid || idx)
      const draft = loreDraftsRef.current[key]
      const name = draft?.name ?? entry.name ?? ''
      const orderStr = draft?.order ?? (entry as any)._io
      const insertion_order = Number(orderStr ?? entry.insertion_order ?? 0) || 0
      const keysVal = draft?.keys != null
        ? draft.keys.split(',').map(s => s.trim()).filter(Boolean)
        : entry.keys
      const content = draft?.content ?? entry.content ?? ''
      const { _lid, _io, ...rest } = entry as any
      return {
        ...rest,
        name,
        keys: keysVal,
        content,
        insertion_order
      }
    })

    const finalScripts = scripts.map((sc, idx) => {
      const key = String(sc?.id || idx)
      const draft = scriptDraftsRef.current[key]
      return {
        id: sc.id,
        name: draft?.name ?? sc.name ?? '',
        type: sc.type,
        in: draft?.in ?? sc.in ?? '',
        out: draft?.out ?? sc.out ?? '',
        flags: draft?.flags ?? sc.flags ?? 'g',
        enabled: sc.enabled !== false
      }
    })

    // 4) 캐릭터 TTS 구성
    let characterTTSConfig: any = null
    if (characterTTSProvider === 'gemini') {
      characterTTSConfig = {
        provider: 'gemini',
        model: characterTTSModel || 'gemini-2.5-flash-preview-tts',
        voice: characterTTSVoice || 'Zephyr'
      }
    } else if (characterTTSProvider === 'fishaudio') {
      characterTTSConfig = { provider: 'fishaudio', model: characterTTSModel }
    } else {
      characterTTSConfig = null
    }

    // 5) 최종 페르소나 객체 구성 후 콜백
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
            ...(v3.data.character_book || {}),
            entries: finalLoreEntries
          },
          extensions: {
            ...(v3.data.extensions || {}),
            characterTTS: characterTTSConfig,
            risuai: {
              ...((v3.data.extensions || {}).risuai || {}),
              customScripts: finalScripts
            }
          }
        }
      }
    }

    
    // Save current author notes draft for this room
    try { setRoomAuthorNotes(activeRoomId || 'default', authorNotesDraftRef.current ?? authorNotes) } catch {}
    onChange(next)
    // rooms UI도 동기화 (지연 적용)
    setTimeout(() => { setRooms(finalRooms) }, 0)
    try { const w:any = window as any; if (w && w.__CSP_DEBUG) { console.log('[CSP] saveAll:end') } } catch {}
  }

  // UI helpers
  const PanelWrapper = ({ children }: {children: React.ReactNode}) => (
    <div 
      className="fixed top-0 right-0 bottom-0 z-[70] w-full md:w-[unset]"
      style={{ width: isMdUp ? `calc(100vw - ${leftOffset}px)` : '100vw', display: open ? 'block' : 'none', left: isMdUp ? undefined : 0 }}
    >
      <div className="h-full bg-slate-900/95 border-l border-slate-700/50 shadow-2xl backdrop-blur-xl p-4 md:p-6 overflow-auto">
        {children}
      </div>
    </div>
  )

  return (
    <>
      {/* overlay: 데스크톱에서만 표시 (사이드바 영역 비우기). 모바일에서는 사이드바 위로 패널을 올리고 입력 가로막지 않도록 오버레이 제거 */}
      {isMdUp && (
        <div 
          className="fixed bg-black/40 backdrop-blur-sm z-[65]" 
          style={{ display: open ? 'block' : 'none', top: 0, right: 0, bottom: 0, left: `${leftOffset}px` }}
          onClick={onClose} 
        />
      )}
      <PanelWrapper>
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div className="flex items-center gap-2">
            {/* 모바일 전용 뒤로가기 */}
            <button
              onClick={onClose}
              className="md:hidden w-9 h-9 -ml-1 rounded-lg hover:bg-slate-700/60 text-white flex items-center justify-center"
              aria-label="뒤로가기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-slate-300 text-sm font-semibold">캐릭터 편집</div>
          </div>
          <div className="flex gap-2">
            <button 
              onMouseDown={(e) => e.preventDefault()} 
              onClick={saveAll} 
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              저장
            </button>
            <button onClick={onClose} className="hidden md:inline-flex px-4 py-2 rounded-lg bg-slate-700/70 hover:bg-slate-600/70 text-slate-200">닫기</button>
          </div>
        </div>

        {/* 모바일 탭 바 */}
        <div className="md:hidden sticky top-0 z-10 -mx-4 md:mx-0 mb-4 bg-slate-900/95 border-b border-slate-700/50">
          <div className="px-4 py-2 flex items-center gap-2 overflow-x-auto">
            <button onClick={()=>setMobileTab('rooms')} className={`px-3 py-1.5 rounded-lg text-sm ${mobileTab==='rooms'?'bg-teal-600 text-white':'bg-slate-800/60 text-slate-200'}`}>채팅방</button>
            <button onClick={()=>setMobileTab('card')} className={`px-3 py-1.5 rounded-lg text-sm ${mobileTab==='card'?'bg-teal-600 text-white':'bg-slate-800/60 text-slate-200'}`}>카드</button>
            <button onClick={()=>setMobileTab('lore')} className={`px-3 py-1.5 rounded-lg text-sm ${mobileTab==='lore'?'bg-teal-600 text-white':'bg-slate-800/60 text-slate-200'}`}>로어북</button>
            <button onClick={()=>setMobileTab('scripts')} className={`px-3 py-1.5 rounded-lg text-sm ${mobileTab==='scripts'?'bg-teal-600 text-white':'bg-slate-800/60 text-slate-200'}`}>스크립트</button>
          </div>
        </div>

  {/* 데스크톱 4-컬럼 레이아웃 */}
  <div className="hidden md:grid [grid-template-columns:1fr_auto_1fr_auto_1fr_auto_1fr] gap-6">
          {/* 1. Sessions */}
          <div className="space-y-3">
            <div className="text-sm font-bold text-slate-300 text-center">채팅방</div>
            <div className="text-xs font-bold text-slate-300 flex items-center gap-2"><IconCog className="w-4 h-4 text-teal-400" /> 채팅방 정보</div>
            <div className="space-y-2">
              {rooms.map(r=> {
                const draft = roomDraftsRef.current[r.id] || { name: r.name }
                return (
                  <div key={r.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${activeRoomId===r.id? 'border-teal-500/60 bg-slate-800/60':'border-slate-700/50 bg-slate-900/40'}`}>
                    <label htmlFor={`room-name-${r.id}`} className="sr-only">채팅방 이름</label>
                    <SmartInput
                      id={`room-name-${r.id}`}
                      name={`room-name-${r.id}`}
                      className="flex-1 bg-transparent outline-none text-slate-100"
                      value={draft.name}
                      onDraftChange={roomDraftHandlers[r.id]?.name}
                      onCommit={() => commitRoomDraft(r.id)}
                    />
                    <button onClick={()=>emitRoomChange(r.id)} className={`p-1.5 rounded ${activeRoomId===r.id? 'bg-teal-600 text-white':'bg-slate-700/70 text-slate-200 hover:bg-slate-600/70'}`} title="활성화">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2v10"/>
                        <path d="M6.5 11a5.5 5.5 0 1 0 11 0"/>
                      </svg>
                    </button>
                    <button onClick={()=>removeRoom(r.id)} className="p-1 text-slate-300 hover:text-red-400"><IconTrash className="w-4 h-4"/></button>
                  </div>
                )
              })}
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
              <SmartInput
                id="card-name"
                name="card-name"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2"
                value={cardDraftsRef.current.name ?? cardName}
                onDraftChange={cardDraftHandlers.name}
                onCommit={() => commitCardDraft('name')}
              />
            </div>
            <div>
              <label htmlFor="card-desc" className="block text-xs text-slate-400 mb-1">설명 {'{{char_description}}'}</label>
              <SmartTextarea
                id="card-desc"
                name="card-desc"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[160px]"
                value={cardDraftsRef.current.desc ?? cardDesc}
                onDraftChange={cardDraftHandlers.desc}
                onCommit={() => commitCardDraft('desc')}
              />
            </div>
            <div>
              <label htmlFor="card-global-override" className="block text-xs text-slate-400 mb-1">글로벌 노트 덮어쓰기</label>
              <SmartTextarea
                id="card-global-override"
                name="card-global-override"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[120px]"
                value={cardDraftsRef.current.globalOverride ?? globalOverride}
                onDraftChange={cardDraftHandlers.globalOverride}
                onCommit={() => commitCardDraft('globalOverride')}
              />
            </div>

            {/* Author Notes (session scoped per room) */}
            <div>
              <label htmlFor="card-author-notes" className="block text-xs text-slate-400 mb-1">작가의 노트</label>
              <SmartTextarea
                id="card-author-notes"
                name="card-author-notes"
                className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[120px]"
                value={authorNotesDraftRef.current ?? authorNotes}
                onDraftChange={(v)=>{ authorNotesDraftRef.current = v; try { const evt = new CustomEvent('authorNotesChanged', { detail: { roomId: activeRoomId || 'default', notes: v } }); window.dispatchEvent(evt) } catch {} }}
                onCommit={commitAuthorNotesDraft}
              />
            </div>
            
            {/* 캐릭터 TTS 설정 */}
            <div className="space-y-2 bg-slate-800/30 p-3 rounded-lg border border-slate-700/50">
              <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
                <span className="text-purple-400">🔊</span> 캐릭터 TTS
              </div>
              <div>
                <label htmlFor="char-tts-provider" className="block text-xs text-slate-400 mb-1">TTS 제공자</label>
                <select
                  id="char-tts-provider"
                  value={characterTTSProvider}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    setCharacterTTSProvider(newProvider);
                    // Provider 변경 시 model 초기화
                    if (newProvider === 'gemini') {
                      setCharacterTTSModel('gemini-2.5-flash-preview-tts');
                    } else if (newProvider === 'fishaudio') {
                      setCharacterTTSModel('');
                    } else {
                      setCharacterTTSModel('');
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs"
                >
                  <option value="none">사용안함</option>
                  <option value="gemini">Gemini (Google)</option>
                  <option value="fishaudio">FishAudio</option>
                </select>
              </div>
              {characterTTSProvider === 'gemini' && (
                <>
                  <div>
                    <label htmlFor="char-tts-model" className="block text-xs text-slate-400 mb-1">TTS 모델</label>
                    <select
                      id="char-tts-model"
                      value={characterTTSModel || 'gemini-2.5-flash-preview-tts'}
                      onChange={(e) => setCharacterTTSModel(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs"
                    >
                      <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts</option>
                      <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="char-tts-voice" className="block text-xs text-slate-400 mb-1">음성</label>
                    <select
                      id="char-tts-voice"
                      value={characterTTSVoice}
                      onChange={(e) => setCharacterTTSVoice(e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs"
                    >
                      <option value="Achernar">Achernar (Soft · 여성)</option>
                      <option value="Achird">Achird (Friendly · 남성)</option>
                      <option value="Algenib">Algenib (Gravelly · 남성)</option>
                      <option value="Algieba">Algieba (Smooth · 남성)</option>
                      <option value="Alnilam">Alnilam (Firm · 남성)</option>
                      <option value="Aoede">Aoede (Breezy · 여성)</option>
                      <option value="Autonoe">Autonoe (Bright · 여성)</option>
                      <option value="Callirrhoe">Callirrhoe (Easy-going · 여성)</option>
                      <option value="Charon">Charon (Informative · 남성)</option>
                      <option value="Despina">Despina (Smooth · 여성)</option>
                      <option value="Enceladus">Enceladus (Breathy · 남성)</option>
                      <option value="Erinome">Erinome (Clear · 여성)</option>
                      <option value="Fenrir">Fenrir (Excitable · 남성)</option>
                      <option value="Gacrux">Gacrux (Mature · 여성)</option>
                      <option value="Iapetus">Iapetus (Clear · 남성)</option>
                      <option value="Kore">Kore (Firm · 여성)</option>
                      <option value="Laomedeia">Laomedeia (Upbeat · 여성)</option>
                      <option value="Leda">Leda (Youthful · 여성)</option>
                      <option value="Orus">Orus (Firm · 남성)</option>
                      <option value="Pulcherrima">Pulcherrima (Forward · 여성)</option>
                      <option value="Puck">Puck (Upbeat · 남성)</option>
                      <option value="Rasalgethi">Rasalgethi (Informative · 남성)</option>
                      <option value="Sadachbia">Sadachbia (Lively · 여성)</option>
                      <option value="Sadaltager">Sadaltager (Knowledgeable · 남성)</option>
                      <option value="Schedar">Schedar (Even · 남성)</option>
                      <option value="Sulafat">Sulafat (Warm · 여성)</option>
                      <option value="Umbriel">Umbriel (Easy-going · 남성)</option>
                      <option value="Vindemiatrix">Vindemiatrix (Gentle · 여성)</option>
                      <option value="Zephyr">Zephyr (Bright · 여성)</option>
                      <option value="Zubenelgenubi">Zubenelgenubi (Casual · 남성)</option>
                    </select>
                  </div>
                </>
              )}
              {characterTTSProvider === 'fishaudio' && (
                <div>
                  <label htmlFor="char-tts-model" className="block text-xs text-slate-400 mb-1">FishAudio 모델 ID</label>
                  <input
                    id="char-tts-model"
                    type="text"
                    value={characterTTSModel}
                    onChange={(e) => setCharacterTTSModel(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs"
                    placeholder="FishAudio 모델 ID 입력"
                  />
                </div>
              )}
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
                            <SmartInput
                              id={`lore-name-${entry._lid||originalIndex}`}
                              name={`lore-name-${entry._lid||originalIndex}`}
                              className="flex-1 rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                              placeholder="이름"
                              value={draft.name}
                              onDraftChange={loreDraftHandlers[entryKey]?.name}
                              onCommit={() => commitLoreDraft(entryKey, originalIndex)}
                            />
                            <label htmlFor={`lore-order-${entry._lid||originalIndex}`} className="sr-only">배치</label>
                            <SmartInput
                              id={`lore-order-${entry._lid||originalIndex}`}
                              name={`lore-order-${entry._lid||originalIndex}`}
                              className="w-24 rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                              placeholder="배치"
                              inputMode="numeric"
                              value={draft.order}
                              onDraftChange={loreDraftHandlers[entryKey]?.order}
                              onCommit={() => commitLoreDraft(entryKey, originalIndex)}
                            />
                          </div>
                          <label htmlFor={`lore-keys-${entry._lid||originalIndex}`} className="sr-only">활성화 키</label>
                          <SmartInput
                            id={`lore-keys-${entry._lid||originalIndex}`}
                            name={`lore-keys-${entry._lid||originalIndex}`}
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                            placeholder="활성화 키 (쉼표로 구분)"
                            value={draft.keys}
                            onDraftChange={loreDraftHandlers[entryKey]?.keys}
                            onCommit={() => commitLoreDraft(entryKey, originalIndex)}
                          />
                      <div className="flex items-center gap-3 text-xs text-slate-300">
                        <label htmlFor={`lore-selective-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-selective-${entry._lid||originalIndex}`} name={`lore-selective-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.selective} onChange={e=>patchLoreEntry(originalIndex, { selective: e.target.checked })} /> 멀티키(모두 충족)</label>
                        <label htmlFor={`lore-constant-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-constant-${entry._lid||originalIndex}`} name={`lore-constant-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.constant} onChange={e=>patchLoreEntry(originalIndex, { constant: e.target.checked })} /> 언제나 활성화</label>
                        <label htmlFor={`lore-useregex-${entry._lid||originalIndex}`} className="flex items-center gap-1"><input id={`lore-useregex-${entry._lid||originalIndex}`} name={`lore-useregex-${entry._lid||originalIndex}`} type="checkbox" checked={!!entry.use_regex} onChange={e=>patchLoreEntry(originalIndex, { use_regex: e.target.checked })} /> 정규식</label>
                      </div>
                          <label htmlFor={`lore-content-${entry._lid||originalIndex}`} className="sr-only">내용</label>
                          <SmartTextarea
                            id={`lore-content-${entry._lid||originalIndex}`}
                            name={`lore-content-${entry._lid||originalIndex}`}
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 min-h-[120px]"
                            placeholder="content"
                            value={draft.content}
                            onDraftChange={loreDraftHandlers[entryKey]?.content}
                            onCommit={() => commitLoreDraft(entryKey, originalIndex)}
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
                            <SmartInput
                              id={`script-name-${sc.id||idx}`}
                              name={`script-name-${sc.id||idx}`}
                              className="rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                              placeholder="이름"
                              value={draft.name}
                              onDraftChange={scriptDraftHandlers[scriptKey]?.name}
                              onCommit={() => commitScriptDraft(scriptKey, idx)}
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
                          <SmartInput
                            id={`script-in-${sc.id||idx}`}
                            name={`script-in-${sc.id||idx}`}
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                            placeholder="IN (정규식)"
                            value={draft.in}
                            onDraftChange={scriptDraftHandlers[scriptKey]?.in}
                            onCommit={() => commitScriptDraft(scriptKey, idx)}
                          />
                          <label htmlFor={`script-flags-${sc.id||idx}`} className="sr-only">플래그</label>
                          <SmartInput
                            id={`script-flags-${sc.id||idx}`}
                            name={`script-flags-${sc.id||idx}`}
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1"
                            placeholder="플래그 (예: gmi)"
                            value={draft.flags}
                            onDraftChange={scriptDraftHandlers[scriptKey]?.flags}
                            onCommit={() => commitScriptDraft(scriptKey, idx)}
                          />
                          <label htmlFor={`script-out-${sc.id||idx}`} className="sr-only">OUT 템플릿</label>
                          <SmartTextarea
                            id={`script-out-${sc.id||idx}`}
                            name={`script-out-${sc.id||idx}`}
                            className="w-full rounded bg-slate-800/60 border border-slate-700/50 px-2 py-1 min-h-[100px]"
                            placeholder="OUT ($1, $2, $& 사용 가능)"
                            value={draft.out}
                            onDraftChange={scriptDraftHandlers[scriptKey]?.out}
                            onCommit={() => commitScriptDraft(scriptKey, idx)}
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

        {/* 모바일: 탭에 따라 섹션 노출 */}
        <div className="md:hidden space-y-4">
          {mobileTab==='rooms' && (
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-300 text-center">채팅방</div>
              <div className="space-y-2">
                {rooms.map(r=> {
                  const draft = roomDraftsRef.current[r.id] || { name: r.name }
                  return (
                    <div key={r.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${activeRoomId===r.id? 'border-teal-500/60 bg-slate-800/60':'border-slate-700/50 bg-slate-900/40'}`}>
                      <label htmlFor={`m-room-name-${r.id}`} className="sr-only">채팅방 이름</label>
                      <SmartInput id={`m-room-name-${r.id}`} name={`m-room-name-${r.id}`} className="flex-1 bg-transparent outline-none text-slate-100" value={draft.name} onDraftChange={roomDraftHandlers[r.id]?.name} onCommit={()=>commitRoomDraft(r.id)} />
                      <button onClick={()=>emitRoomChange(r.id)} className={`p-1.5 rounded ${activeRoomId===r.id? 'bg-teal-600 text-white':'bg-slate-700/70 text-slate-200 hover:bg-slate-600/70'}`} title="활성화">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10"/><path d="M6.5 11a5.5 5.5 0 1 0 11 0"/></svg>
                      </button>
                      <button onClick={()=>removeRoom(r.id)} className="p-1 text-slate-300 hover:text-red-400"><IconTrash className="w-4 h-4"/></button>
                    </div>
                  )
                })}
                <button onClick={addRoom} className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200">+ 새 채팅</button>
              </div>
            </div>
          )}

          {mobileTab==='card' && (
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-300 text-center">카드</div>
              <div>
                <label htmlFor="m-card-name" className="block text-xs text-slate-400 mb-1">이름 {'{{char}}'}</label>
                <SmartInput id="m-card-name" name="m-card-name" value={cardDraftsRef.current.name ?? cardName} onCommit={(v)=>{ cardDraftHandlers.name(v); commitCardDraft('name') }} className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2" />
              </div>
              <div>
                <label htmlFor="m-card-desc" className="block text-xs text-slate-400 mb-1">설명 {'{{char_description}}'}</label>
                <SmartTextarea id="m-card-desc" name="m-card-desc" value={cardDraftsRef.current.desc ?? cardDesc} onCommit={(v)=>{ cardDraftHandlers.desc(v); commitCardDraft('desc') }} className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[160px]" />
              </div>
              <div>
                <label htmlFor="m-card-go" className="block text-xs text-slate-400 mb-1">글로벌 노트 덮어쓰기</label>
                <SmartTextarea id="m-card-go" name="m-card-go" value={cardDraftsRef.current.globalOverride ?? globalOverride} onCommit={(v)=>{ cardDraftHandlers.globalOverride(v); commitCardDraft('globalOverride') }} className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[120px]" />
              </div>
              <div>
                <label htmlFor="m-author-notes" className="block text-xs text-slate-400 mb-1">작가의 노트</label>
                <SmartTextarea id="m-author-notes" name="m-author-notes" value={authorNotesDraftRef.current ?? authorNotes} onCommit={async (v)=>{ authorNotesDraftRef.current = v; try { const evt = new CustomEvent('authorNotesChanged', { detail: { roomId: activeRoomId || 'default', notes: v } }); window.dispatchEvent(evt) } catch {}; await commitAuthorNotesDraft() }} className="w-full rounded-lg border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 min-h-[120px]" />
              </div>
              {/* 캐릭터 TTS (모바일) */}
              <div className="space-y-2 bg-slate-800/30 p-3 rounded-lg border border-slate-700/50">
                <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
                  <span className="text-purple-400">🔊</span> 캐릭터 TTS
                </div>
                <div>
                  <label htmlFor="m-tts-provider" className="block text-xs text-slate-400 mb-1">TTS 제공자</label>
                  <select id="m-tts-provider" value={characterTTSProvider} onChange={(e)=>{ const p = e.target.value; setCharacterTTSProvider(p); if(p==='gemini'){ setCharacterTTSModel('gemini-2.5-flash-preview-tts'); } else { setCharacterTTSModel(''); } }} className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs">
                    <option value="none">사용안함</option>
                    <option value="gemini">Gemini (Google)</option>
                    <option value="fishaudio">FishAudio</option>
                  </select>
                </div>
                {characterTTSProvider==='gemini' && (
                  <>
                    <div>
                      <label htmlFor="m-tts-model" className="block text-xs text-slate-400 mb-1">TTS 모델</label>
                      <select id="m-tts-model" value={characterTTSModel || 'gemini-2.5-flash-preview-tts'} onChange={(e)=>setCharacterTTSModel(e.target.value)} className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs">
                        <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts</option>
                        <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="m-tts-voice" className="block text-xs text-slate-400 mb-1">음성</label>
                      <select id="m-tts-voice" value={characterTTSVoice} onChange={(e)=>setCharacterTTSVoice(e.target.value)} className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs">
                        <option value="Achernar">Achernar (Soft · 여성)</option>
                        <option value="Achird">Achird (Friendly · 남성)</option>
                        <option value="Algenib">Algenib (Gravelly · 남성)</option>
                        <option value="Algieba">Algieba (Smooth · 남성)</option>
                        <option value="Alnilam">Alnilam (Firm · 남성)</option>
                        <option value="Aoede">Aoede (Breezy · 여성)</option>
                        <option value="Autonoe">Autonoe (Bright · 여성)</option>
                        <option value="Callirrhoe">Callirrhoe (Easy-going · 여성)</option>
                        <option value="Charon">Charon (Informative · 남성)</option>
                        <option value="Despina">Despina (Smooth · 여성)</option>
                        <option value="Enceladus">Enceladus (Breathy · 남성)</option>
                        <option value="Erinome">Erinome (Clear · 여성)</option>
                        <option value="Fenrir">Fenrir (Excitable · 남성)</option>
                        <option value="Gacrux">Gacrux (Mature · 여성)</option>
                        <option value="Iapetus">Iapetus (Clear · 남성)</option>
                        <option value="Kore">Kore (Firm · 여성)</option>
                        <option value="Laomedeia">Laomedeia (Upbeat · 여성)</option>
                        <option value="Leda">Leda (Youthful · 여성)</option>
                        <option value="Orus">Orus (Firm · 남성)</option>
                        <option value="Pulcherrima">Pulcherrima (Forward · 여성)</option>
                        <option value="Puck">Puck (Upbeat · 남성)</option>
                        <option value="Rasalgethi">Rasalgethi (Informative · 남성)</option>
                        <option value="Sadachbia">Sadachbia (Lively · 여성)</option>
                        <option value="Sadaltager">Sadaltager (Knowledgeable · 남성)</option>
                        <option value="Schedar">Schedar (Even · 남성)</option>
                        <option value="Sulafat">Sulafat (Warm · 여성)</option>
                        <option value="Umbriel">Umbriel (Easy-going · 남성)</option>
                        <option value="Vindemiatrix">Vindemiatrix (Gentle · 여성)</option>
                        <option value="Zephyr">Zephyr (Bright · 여성)</option>
                        <option value="Zubenelgenubi">Zubenelgenubi (Casual · 남성)</option>
                      </select>
                    </div>
                  </>
                )}
                {characterTTSProvider==='fishaudio' && (
                  <div>
                    <label htmlFor="m-tts-model-fish" className="block text-xs text-slate-400 mb-1">FishAudio 모델 ID</label>
                    <input id="m-tts-model-fish" type="text" value={characterTTSModel} onChange={(e)=>setCharacterTTSModel(e.target.value)} className="w-full px-2 py-1.5 bg-slate-800/60 border border-slate-700/50 rounded text-slate-100 text-xs" placeholder="FishAudio 모델 ID 입력" />
                  </div>
                )}
              </div>
            </div>
          )}

          {mobileTab==='lore' && (
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-300 text-center">로어북</div>
              {/* Add button for convenience on mobile */}
              <button className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" onClick={()=> {
                const _lid = (crypto?.randomUUID ? crypto.randomUUID() : `l-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                const nextItem = { _lid, keys: [], content: '', insertion_order: 0, enabled: true }
                setLoreEntries(prev => ([...(prev||[]), nextItem]))
                const key = String(_lid)
                setOpenLoreIdx(prev => ({ ...prev, [key]: true }))
              }}>+ 항목 추가</button>
            </div>
          )}

          {mobileTab==='scripts' && (
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-300 text-center">스크립트</div>
              <button className="w-full py-2 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" onClick={()=> {
                const id = (crypto?.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)
                const newItem: RegexScript = { id, name: '', type: 'display', in: '', out: '', flags: 'g', enabled: true }
                setScripts(prev => ([...(prev||[]), newItem]))
                const key = String(id)
                setOpenScriptIdx(prev => ({ ...prev, [key]: true }))
              }}>+ 스크립트 추가</button>
            </div>
          )}
        </div>
      </PanelWrapper>
    </>
  )
})

CharacterSidePanel.displayName = 'CharacterSidePanel'

export default CharacterSidePanel
