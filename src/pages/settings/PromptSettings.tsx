import React from 'react'
import { setSettings as idbSetSettings } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export type PromptBlock = {
  id: string
  name: string
  type: 'pure' | 'conversation' | 'longterm' | 'system' | 'lorebook' | 'author_notes' | 'global_override' | 'final_insert'
  prompt?: string
  role: 'user' | 'assistant' | 'system'
  startIndex?: number
  endIndex?: number
  count?: number
}

export default function PromptSettings(props: any){
  const { cfg, setCfg, promptBlocks, setPromptBlocks, promptRightTab, expandedBlocks, setExpandedBlocks, dragIndexRef, promptLocalRef, promptCommitRef } = props

  // Regex Scripts (전역) - 캐릭터 카드 스크립트 UI와 동일한 데이터 구조
  type RegexScript = {
    id: string
    name?: string
    type?: 'request' | 'display' | 'input' | 'output' | 'disabled'
    in: string
    out: string
    flags?: string
    enabled?: boolean
  }

  const [localBlocks, setLocalBlocks] = React.useState<PromptBlock[]>(() =>
    (promptBlocks || []).map((b: any, i: number) => (b.id ? b : { ...b, id: `block-${Date.now()}-${i}-${Math.random()}` }))
  )
  // keep latest localBlocks for beforeunload/debounce
  const localBlocksRef = React.useRef<PromptBlock[]>([])
  React.useEffect(() => { localBlocksRef.current = localBlocks }, [localBlocks])
  
  // Draft ref for prompt content to avoid re-renders on typing
  const promptDraftsRef = React.useRef<Record<string, string>>({})
  
  // track edit state to suppress autosave while typing
  const isEditingRef = React.useRef(false)

  React.useEffect(() => {
    if (promptLocalRef) {
      promptLocalRef.current = localBlocks
    }
  }, [localBlocks, promptLocalRef])

  // Do not resync from parent after initial state; avoid overwriting user edits

  // Minimal leave-page autosave using ref
  React.useEffect(() => {
    const onBeforeUnload = () => {
      const blocks = localBlocksRef.current
      const newCfg = { ...cfgRef.current, promptBlocks: blocks }
      idbSetSettings(newCfg).catch(() => {})
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Keep latest cfg in a ref to build newCfg without changing autoSave identity
  const cfgRef = React.useRef(cfg)
  React.useEffect(() => { cfgRef.current = cfg }, [cfg])

  // Expose commit function via ref for parent to call before saving
  React.useEffect(() => {
    if (promptCommitRef) {
      promptCommitRef.current = () => {
        // 1) Commit all prompt drafts from ref
        setLocalBlocks((prev) => {
          const updated = prev.map(block => {
            const draft = promptDraftsRef.current[block.id]
            if (draft !== undefined && draft !== block.prompt) {
              return { ...block, prompt: draft }
            }
            return block
          })
          return updated
        })

        // 2) Commit all script drafts from ref and persist immediately
        try {
          const current = scriptsRef.current || []
          const updatedScripts = current.map((sc, idx) => {
            const key = sc.id || String(idx)
            const draft = scriptDraftsRef.current[key]
            if (!draft) return sc
            return {
              ...sc,
              name: draft.name ?? sc.name,
              in: draft.in ?? sc.in,
              flags: draft.flags ?? sc.flags,
              out: draft.out ?? sc.out
            }
          })
          // update state sync and save
          setScripts(updatedScripts)
          // persist
          ;(async () => { try { await autoSaveScripts(updatedScripts) } catch {} })()
        } catch {}
      }
    }
  }, [promptCommitRef])

  // ===== Scripts State & Drafts =====
  const [scripts, setScripts] = React.useState<RegexScript[]>(() => {
    const raw = Array.isArray(cfg?.regexScripts) ? cfg.regexScripts : []
    return raw.map((e: any, i: number) => ({
      id: e?.id || `rs-${Date.now()}-${i}-${Math.random()}`,
      name: e?.name || '',
      type: (e?.type === 'input' || e?.type === 'output' || e?.type === 'request' || e?.type === 'display' || e?.type === 'disabled') ? e.type : 'display',
      in: e?.in || '',
      out: e?.out ?? '',
      flags: e?.flags || 'g',
      enabled: e?.enabled !== false
    }))
  })
  // Keep latest scripts ref for autosave
  const scriptsRef = React.useRef<RegexScript[]>([])
  React.useEffect(() => { scriptsRef.current = scripts }, [scripts])
  // Drafts for script fields
  const scriptDraftsRef = React.useRef<Record<string, { name?: string, in?: string, flags?: string, out?: string }>>({})
  // Initialize missing drafts lazily
  React.useEffect(() => {
    scripts.forEach((sc, idx) => {
      const key = sc.id || String(idx)
      if (!scriptDraftsRef.current[key]) {
        scriptDraftsRef.current[key] = { name: sc.name || '', in: sc.in || '', flags: sc.flags || 'g', out: sc.out || '' }
      }
    })
  }, [scripts.length])
  // Handlers
  const scriptDraftHandlersRef = React.useRef<Record<string, Record<string, (val: string) => void>>>({})
  scripts.forEach((sc, idx) => {
    const key = sc.id || String(idx)
    if (!scriptDraftHandlersRef.current[key]) {
      scriptDraftHandlersRef.current[key] = {
        name: (val: string) => { scriptDraftsRef.current[key] = { ...scriptDraftsRef.current[key], name: val } },
        in: (val: string) => { scriptDraftsRef.current[key] = { ...scriptDraftsRef.current[key], in: val } },
        flags: (val: string) => { scriptDraftsRef.current[key] = { ...scriptDraftsRef.current[key], flags: val } },
        out: (val: string) => { scriptDraftsRef.current[key] = { ...scriptDraftsRef.current[key], out: val } }
      }
    }
  })
  const scriptDraftHandlers = scriptDraftHandlersRef.current

  // Track expand/collapse state per script (default collapsed) and persist across tab switches
  const [openScriptIdx, setOpenScriptIdx] = React.useState<Record<string, boolean>>(() => {
    try {
      const raw = sessionStorage.getItem('settingsPromptScriptsOpen')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  React.useEffect(() => {
    try { sessionStorage.setItem('settingsPromptScriptsOpen', JSON.stringify(openScriptIdx || {})) } catch {}
  }, [openScriptIdx])

  const patchScript = React.useCallback((index: number, patch: Partial<RegexScript>) => {
    setScripts((prev) => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const cur = prev[index]
      const next = { ...cur, ...patch }
      if (JSON.stringify(cur) === JSON.stringify(next)) return prev
      const clone = prev.slice()
      clone[index] = next
      return clone
    })
  }, [])

  const removeScript = React.useCallback((index: number) => {
    setScripts((prev) => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const clone = prev.slice()
      const removed = clone.splice(index, 1)
      // save on delete
      autoSaveScripts(clone)
      return clone
    })
  }, [])

  const commitScriptDraft = React.useCallback((id: string, index: number) => {
    const draft = scriptDraftsRef.current[id]
    if (!draft) return
    setScripts((prev) => {
      if (!Array.isArray(prev) || index < 0 || index >= prev.length) return prev
      const cur = prev[index]
      const next = { ...cur, name: draft.name ?? cur.name, in: draft.in ?? cur.in, flags: draft.flags ?? cur.flags, out: draft.out ?? cur.out }
      const clone = prev.slice()
      clone[index] = next
      return clone
    })
    // save after commit
    setTimeout(() => autoSaveScripts(scriptsRef.current), 0)
  }, [])

  const addScript = () => {
    const id = `rs-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const item: RegexScript = { id, name: '', type: 'display', in: '', out: '', flags: 'g', enabled: true }
    setScripts((prev) => {
      const arr = [...(prev || []), item]
      // save on add
      autoSaveScripts(arr)
      return arr
    })
  }

  const autoSaveScripts = React.useCallback(async (list: RegexScript[]) => {
    try {
      // Update cfg in parent and persist
      setCfg((prev: any) => ({ ...prev, regexScripts: list }))
      const newCfg = { ...cfgRef.current, regexScripts: list }
      await idbSetSettings(newCfg)
      console.log('[PromptSettings] Saved regexScripts:', list.length)
    } catch (e) {
      console.error('[PromptSettings] Save regexScripts failed:', e)
    }
  }, [setCfg])

  const autoSave = React.useCallback(async (blocks: PromptBlock[]) => {
    try {
      // Update parent states
      setPromptBlocks(blocks)
      setCfg((prev: any) => ({ ...prev, promptBlocks: blocks }))
      // Persist with latest cfg
      const newCfg = { ...cfgRef.current, promptBlocks: blocks }
      await idbSetSettings(newCfg)
      console.log('[PromptSettings] Auto-saved', blocks.length, 'blocks')
    } catch (e) {
      console.error('[PromptSettings] Auto-save failed:', e)
    }
  }, [setCfg, setPromptBlocks])

  // No periodic auto-save; we save only on explicit actions (add/delete/reorder)

  const updateBlockField = (index: number, patch: Partial<PromptBlock>) => {
    setLocalBlocks((prev) => {
      const arr = [...prev]
      const target = arr[index]
      if (!target) return prev
      arr[index] = { ...target, ...patch } as PromptBlock
      // mark editing; do NOT autosave here
      isEditingRef.current = true
      return arr
    })
  }

  const commitEdits = React.useCallback(() => {
    // First, commit all prompt drafts from ref
    setLocalBlocks((prev) => {
      const updated = prev.map(block => {
        const draft = promptDraftsRef.current[block.id]
        if (draft !== undefined && draft !== block.prompt) {
          return { ...block, prompt: draft }
        }
        return block
      })
      return updated
    })
    
    // Then save after a brief delay to ensure state is updated
    setTimeout(() => {
      const blocks = localBlocksRef.current
      if (!blocks) return
      isEditingRef.current = false
      autoSave(blocks)
    }, 0)
  }, [autoSave])

  const removeBlockSmart = (id: string, index: number) => {
    setLocalBlocks((prev) => {
      let arr: PromptBlock[]
      if (prev.some(b => b.id === id)) {
        arr = prev.filter(b => b.id !== id)
      } else {
        // fallback: remove by index if id not found
        const idx = Math.min(Math.max(index, 0), prev.length - 1)
        arr = prev.slice(0, idx).concat(prev.slice(idx + 1))
      }
      setExpandedBlocks((prevExp: any) => {
        const copy = { ...prevExp }
        delete copy[id]
        return copy
      })
      // save on delete
      autoSave(arr)
      return arr
    })
  }

  const addBlock = () => {
    const newBlock: PromptBlock = {
      name: '새 블록',
      type: 'pure',
      prompt: '',
      role: 'user',
      id: `block-${Date.now()}-${Math.random()}`
    }
    setLocalBlocks((prev) => {
      const arr = [...prev, newBlock]
      // save on add
      autoSave(arr)
      return arr
    })
  }

  return (
    <div>
      {promptRightTab === 'blocks' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="mb-3 flex justify-between items-center">
            <div className="text-sm text-slate-300">프롬프트 블록 편집</div>
            <button
              type="button"
              className="w-10 h-10 grid place-items-center bg-green-500 text-white rounded font-bold text-xl hover:bg-green-600 leading-none"
              onClick={addBlock}
              aria-label="블록 추가"
            >
              +
            </button>
          </div>
          <div className="space-y-3">
            {localBlocks.map((b: PromptBlock, i: number) => (
              <div
                key={b.id}
                className="border border-slate-700/50 rounded-2xl bg-slate-900/40"
                onDragStart={(e) => {
                  // Only allow drag from the drag handle
                  const target = e.target as HTMLElement;
                  if (!target.closest('.drag-handle')) {
                    e.preventDefault();
                    return;
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragIndexRef.current
                  const to = i
                  if (from == null) return
                  if (from === to) return
                  setLocalBlocks((prev) => {
                    const arr = [...prev]
                    const item = arr.splice(from, 1)[0]
                    arr.splice(to, 0, item)
                    // save on reorder
                    autoSave(arr)
                    return arr
                  })
                  dragIndexRef.current = null
                }}
              >
                <div
                  className="flex items-center justify-between px-3 py-2 cursor-pointer"
                  onMouseDown={(e) => {
                    // Commit edits before the click changes focus/selection
                    if (isEditingRef.current) commitEdits()
                  }}
                  onClick={() => {
                    setExpandedBlocks((x: any) => ({ ...x, [b.id]: !x[b.id] }))
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-slate-200">{b.name || '(이름 없음)'}</div>
                    <div className="text-xs text-slate-400">{b.type}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="w-8 h-8 grid place-items-center bg-red-500 text-white rounded hover:bg-red-600 font-bold text-lg leading-none"
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        removeBlockSmart(b.id, i)
                      }}
                      aria-label="블록 삭제"
                    >
                      -
                    </button>
                    <div 
                      className="drag-handle text-xs text-slate-400 cursor-move px-2 py-1 hover:bg-slate-700/60 rounded"
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        dragIndexRef.current = i;
                        e.dataTransfer!.effectAllowed = 'move';
                      }}
                    >
                      ☰
                    </div>
                  </div>
                </div>
                {expandedBlocks[b.id] && (
                  <div 
                    className="p-4 border-t border-slate-700/50 bg-slate-900/40"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    draggable={false}
                  >
                    <div className="mb-2">
                      <label className="block text-xs text-slate-300" htmlFor={`block-name-${b.id}`}>이름 (설명용)</label>
                      <input
                        id={`block-name-${b.id}`}
                        name={`block-name-${b.id}`}
                        className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 placeholder-slate-500 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                        value={b.name}
                        onChange={(e) => {
                          updateBlockField(i, { name: e.target.value })
                        }}
                        draggable={false}
                        // avoid blur-then-click swallowing first click; save via header mousedown
                      />
                    </div>
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-300" htmlFor={`block-type-${b.id}`}>타입</label>
                        <select
                          id={`block-type-${b.id}`}
                          name={`block-type-${b.id}`}
                          className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                          value={b.type}
                          onChange={(e) => {
                            const val = e.target.value as PromptBlock['type']
                            if (val === 'conversation') {
                              updateBlockField(i, { type: 'conversation', prompt: '', name: '대화 이력', role: 'user', count: 10 })
                            } else if (val === 'system') {
                              updateBlockField(i, { type: 'system', name: '시스템 프롬프트', role: 'system' })
                            } else if (val === 'lorebook') {
                              // 자동: 로어북을 배치 순서대로 여러 메시지로 삽입
                              updateBlockField(i, { type: 'lorebook', name: '로어북', prompt: '', role: b.role || 'user' })
                            } else if (val === 'final_insert') {
                              // 자동: @@depth 0 로 시작하는 프롬프트를 최종 삽입
                              updateBlockField(i, { type: 'final_insert', name: '최종 삽입', prompt: '', role: b.role || 'user' })
                            } else if (val === 'global_override') {
                              // 자동: 캐릭터 카드 글로벌 노트 덮어쓰기
                              updateBlockField(i, { type: 'global_override', name: '글로벌 노트 덮어쓰기', prompt: '', role: b.role || 'system' })
                            } else if (val === 'author_notes') {
                              updateBlockField(i, { type: 'author_notes', name: '작가의 노트', prompt: '', role: b.role || 'system' })
                            } else {
                              updateBlockField(i, { type: val })
                            }
                          }}
                          draggable={false}
                          // save via header mousedown
                        >
                          <option value="system">시스템 프롬프트</option>
                          <option value="pure">순수 프롬프트</option>
                          <option value="conversation">대화</option>
                          <option value="longterm">장기기억</option>
                          <option value="global_override">글로벌 노트 덮어쓰기</option>
                          <option value="lorebook">로어북</option>
                          <option value="final_insert">최종 삽입</option>
                          <option value="author_notes">작가의 노트</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-300" htmlFor={`block-role-${b.id}`}>역할 (role)</label>
                        <select
                          id={`block-role-${b.id}`}
                          name={`block-role-${b.id}`}
                          className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                          value={b.role}
                          onChange={(e) => {
                            updateBlockField(i, { role: e.target.value as 'user' | 'assistant' | 'system' })
                          }}
                          draggable={false}
                          // save via header mousedown
                        >
                          <option value="system">system</option>
                          <option value="user">user</option>
                          <option value="assistant">assistant</option>
                        </select>
                      </div>
                    </div>
                    {b.type === 'conversation' ? (
                      <div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-slate-300" htmlFor={`start-${b.id}`}>시작 인덱스 (startIndex)</label>
                            <input
                              id={`start-${b.id}`}
                              name={`start-${b.id}`}
                              className="w-32 rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                              type="number"
                              min={0}
                              value={b.startIndex ?? 0}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value) || 0)
                                updateBlockField(i, { startIndex: v })
                              }}
                              draggable={false}
                              // save via header mousedown
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-slate-300" htmlFor={`end-${b.id}`}>끝 인덱스 (endIndex)</label>
                            <input
                              id={`end-${b.id}`}
                              name={`end-${b.id}`}
                              className="w-32 rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                              type="number"
                              min={0}
                              value={b.endIndex ?? 0}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value) || 0)
                                updateBlockField(i, { endIndex: v })
                              }}
                              draggable={false}
                              // save via header mousedown
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        {(['lorebook','global_override','author_notes','final_insert'] as PromptBlock['type'][]).includes(b.type) ? (
                          <div className="text-xs text-slate-400">
                            이 블록은 자동으로 내용을 채웁니다. 입력란이 필요하지 않습니다.
                          </div>
                        ) : (
                          <>
                            <label className="block text-xs text-slate-300" htmlFor={`prompt-${b.id}`}>프롬프트 내용</label>
                            <textarea
                              id={`prompt-${b.id}`}
                              name={`prompt-${b.id}`}
                              className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 placeholder-slate-500 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                              rows={6}
                              defaultValue={b.prompt}
                              onChange={(e) => {
                                // Update ref only, no state change
                                promptDraftsRef.current[b.id] = e.target.value
                              }}
                              draggable={false}
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {promptRightTab === 'params' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="text-sm text-slate-300 mb-4">LLM 생성 파라미터</div>
          <div className="grid grid-cols-1 gap-4">
            {/* 최대 콘텍스트 크기 */}
            <div>
              <label className="block text-xs text-slate-300 mb-1" htmlFor="max-context">
                최대 콘텍스트 크기
              </label>
              <input
                id="max-context"
                name="max-context"
                type="number"
                min="1024"
                max="1000000"
                step="1024"
                className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                value={cfg.maxContextSize || 50000}
                onChange={(e) => {
                  const val = Math.max(1024, parseInt(e.target.value) || 50000);
                  setCfg({ ...cfg, maxContextSize: val });
                }}
                placeholder="50000"
              />
              <div className="text-xs text-slate-400 mt-1">
                모델이 처리할 수 있는 최대 토큰 수 (기본값: 50000)
              </div>
            </div>

            {/* 최대 응답 크기 */}
            <div>
              <label className="block text-xs text-slate-300 mb-1" htmlFor="max-output">
                최대 응답 크기
              </label>
              <input
                id="max-output"
                name="max-output"
                type="number"
                min="128"
                max="100000"
                step="128"
                className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                value={cfg.maxOutputTokens || 8192}
                onChange={(e) => {
                  const val = Math.max(128, parseInt(e.target.value) || 8192);
                  setCfg({ ...cfg, maxOutputTokens: val });
                }}
                placeholder="8192"
              />
              <div className="text-xs text-slate-400 mt-1">
                생성될 응답의 최대 토큰 수 (기본값: 8192)
              </div>
            </div>

            {/* Thinking Tokens */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <input
                  id="thinking-enabled"
                  name="thinking-enabled"
                  type="checkbox"
                  checked={cfg.thinkingEnabled ?? true}
                  onChange={(e) => {
                    setCfg({ ...cfg, thinkingEnabled: e.target.checked });
                  }}
                  className="rounded accent-teal-500"
                />
                <label className="text-xs text-slate-300" htmlFor="thinking-enabled">
                  Thinking Tokens 사용
                </label>
              </div>
              {cfg.thinkingEnabled !== false && (
                <input
                  id="thinking-tokens"
                  name="thinking-tokens"
                  type="number"
                  min="0"
                  max="50000"
                  step="500"
                  className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                  value={cfg.thinkingTokens || 5000}
                  onChange={(e) => {
                    const val = Math.max(0, parseInt(e.target.value) || 5000);
                    setCfg({ ...cfg, thinkingTokens: val });
                  }}
                  placeholder="5000"
                />
              )}
              <div className="text-xs text-slate-400 mt-1">
                모델의 내부 추론에 사용할 토큰 수 (기본값: 5000)
              </div>
            </div>

            {/* 온도 (Temperature) */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <input
                  id="temperature-enabled"
                  name="temperature-enabled"
                  type="checkbox"
                  checked={cfg.temperatureEnabled ?? true}
                  onChange={(e) => {
                    setCfg({ ...cfg, temperatureEnabled: e.target.checked });
                  }}
                  className="rounded accent-teal-500"
                />
                <label className="text-xs text-slate-300" htmlFor="temperature-enabled">
                  온도 (Temperature) 사용
                </label>
              </div>
              {cfg.temperatureEnabled !== false && (
                <input
                  id="temperature"
                  name="temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.01"
                  className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                  value={cfg.temperature ?? 1.0}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(2, parseFloat(e.target.value) || 1.0));
                    setCfg({ ...cfg, temperature: val });
                  }}
                  placeholder="1.0"
                />
              )}
              <div className="text-xs text-slate-400 mt-1">
                응답의 창의성 조절 (0.0~2.0, 기본값: 1.0)
              </div>
            </div>

            {/* Top P */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <input
                  id="top-p-enabled"
                  name="top-p-enabled"
                  type="checkbox"
                  checked={cfg.topPEnabled ?? true}
                  onChange={(e) => {
                    setCfg({ ...cfg, topPEnabled: e.target.checked });
                  }}
                  className="rounded accent-teal-500"
                />
                <label className="text-xs text-slate-300" htmlFor="top-p-enabled">
                  Top P 사용
                </label>
              </div>
              {cfg.topPEnabled !== false && (
                <input
                  id="top-p"
                  name="top-p"
                  type="number"
                  min="0"
                  max="1"
                  step="0.01"
                  className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                  value={cfg.topP ?? 0.95}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0.95));
                    setCfg({ ...cfg, topP: val });
                  }}
                  placeholder="0.95"
                />
              )}
              <div className="text-xs text-slate-400 mt-1">
                누적 확률 임계값 (0.0~1.0, 기본값: 0.95)
              </div>
            </div>
          </div>
        </section>
      )}
      {promptRightTab === 'scripts' && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="mb-3 flex justify-between items-center">
            <div className="text-sm text-slate-300">정규식 스크립트</div>
            <button
              type="button"
              className="w-10 h-10 grid place-items-center bg-green-500 text-white rounded font-bold text-xl hover:bg-green-600 leading-none"
              onClick={addScript}
              aria-label="스크립트 추가"
            >
              +
            </button>
          </div>
          <div className="space-y-3">
            {scripts.map((sc, i) => {
              const key = sc.id || String(i)
              const draft = scriptDraftsRef.current[key] || { name: sc.name || '', in: sc.in || '', flags: sc.flags || 'g', out: sc.out || '' }
              const rowOpen = openScriptIdx[key] === true
              return (
                <div key={key} className="border border-slate-700/50 rounded-2xl bg-slate-900/40">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/50"
                    onClick={() => setOpenScriptIdx(prev => ({ ...prev, [key]: !rowOpen }))}
                    aria-expanded={rowOpen}
                  >
                    <div className="flex items-center gap-2 text-slate-200">
                      <svg className={`w-3.5 h-3.5 transition-transform ${rowOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
                      <span className="font-medium truncate max-w-[220px]" title={sc.name || sc.in || `스크립트 ${i+1}`}>{sc.name || sc.in || `스크립트 ${i+1}`}</span>
                      <span className="text-xs text-slate-400">{sc.type || 'display'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-300 flex items-center gap-1" onClick={(e)=>e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={sc.enabled !== false}
                          onChange={(e) => { patchScript(i, { enabled: e.target.checked }); setTimeout(()=>autoSaveScripts(scriptsRef.current), 0) }}
                        /> on
                      </label>
                      <button
                        type="button"
                        className="w-8 h-8 grid place-items-center bg-red-500 text-white rounded hover:bg-red-600 font-bold text-lg leading-none"
                        onClick={(e) => { e.stopPropagation(); removeScript(i) }}
                        aria-label="스크립트 삭제"
                      >
                        -
                      </button>
                    </div>
                  </button>
                  {rowOpen && (
                  <div className="p-4 border-t border-slate-700/50 bg-slate-900/40">
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-300" htmlFor={`rs-name-${key}`}>이름</label>
                        <input
                          id={`rs-name-${key}`}
                          className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                          defaultValue={draft.name}
                          onChange={(e)=>{ scriptDraftHandlers[key]?.name?.(e.target.value) }}
                          onBlur={()=>commitScriptDraft(key, i)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-300" htmlFor={`rs-type-${key}`}>타입</label>
                        <select
                          id={`rs-type-${key}`}
                          className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                          value={sc.type || 'display'}
                          onChange={(e)=>{ patchScript(i, { type: e.target.value as any }); setTimeout(()=>autoSaveScripts(scriptsRef.current), 0) }}
                        >
                          <option value="input">입력문수정</option>
                          <option value="output">출력문수정</option>
                          <option value="request">리퀘스트 데이터 수정</option>
                          <option value="display">디스플레이 수정</option>
                          <option value="disabled">비활성화</option>
                        </select>
                      </div>
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs text-slate-300" htmlFor={`rs-in-${key}`}>IN (정규식)</label>
                      <input
                        id={`rs-in-${key}`}
                        className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                        defaultValue={draft.in}
                        onChange={(e)=>{ scriptDraftHandlers[key]?.in?.(e.target.value) }}
                        onBlur={()=>commitScriptDraft(key, i)}
                        placeholder="예: (\\d+)"
                      />
                    </div>
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-slate-300" htmlFor={`rs-flags-${key}`}>플래그</label>
                        <input
                          id={`rs-flags-${key}`}
                          className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                          defaultValue={draft.flags}
                          onChange={(e)=>{ scriptDraftHandlers[key]?.flags?.(e.target.value) }}
                          onBlur={()=>commitScriptDraft(key, i)}
                          placeholder="gmi"
                        />
                      </div>
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs text-slate-300" htmlFor={`rs-out-${key}`}>OUT 템플릿</label>
                      <textarea
                        id={`rs-out-${key}`}
                        className="w-full rounded border-2 border-slate-700/50 bg-slate-800/60 text-slate-100 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50"
                        rows={4}
                        defaultValue={draft.out}
                        onChange={(e)=>{ scriptDraftHandlers[key]?.out?.(e.target.value) }}
                        onBlur={()=>commitScriptDraft(key, i)}
                        placeholder="$1, $2, $& 같은 그룹 사용 가능"
                      />
                    </div>
                  </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
      {promptRightTab === 'other' && (
        <PresetManager
          cfgRef={cfgRef}
          setCfg={setCfg}
          localBlocksRef={localBlocksRef}
          setLocalBlocks={setLocalBlocks}
          autoSaveBlocks={autoSave}
          scriptsRef={scriptsRef}
          setScripts={setScripts}
          autoSaveScripts={autoSaveScripts}
          promptCommitRef={promptCommitRef}
        />
      )}
    </div>
  )
}

// ===== Preset Manager (inline component) =====
type Preset = {
  id: string
  name: string
  createdAt: number
  params: {
    maxContextSize?: number
    maxOutputTokens?: number
    thinkingEnabled?: boolean
    thinkingTokens?: number
    temperatureEnabled?: boolean
    temperature?: number
    topPEnabled?: boolean
    topP?: number
  }
  promptBlocks: PromptBlock[]
  regexScripts: Array<{ id?: string, name?: string, type?: any, in: string, out: string, flags?: string, enabled?: boolean }>
}

function PresetManager({ cfgRef, setCfg, localBlocksRef, setLocalBlocks, autoSaveBlocks, scriptsRef, setScripts, autoSaveScripts, promptCommitRef }:{
  cfgRef: React.MutableRefObject<any>
  setCfg: (updater: any) => void
  localBlocksRef: React.MutableRefObject<PromptBlock[]>
  setLocalBlocks: React.Dispatch<React.SetStateAction<PromptBlock[]>>
  autoSaveBlocks: (blocks: PromptBlock[]) => Promise<void>
  scriptsRef: React.MutableRefObject<any[]>
  setScripts: React.Dispatch<React.SetStateAction<any[]>>
  autoSaveScripts: (list: any[]) => Promise<void>
  promptCommitRef: React.MutableRefObject<null | (() => void)>
}){
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const presets: Preset[] = Array.isArray(cfgRef.current?.promptPresets) ? cfgRef.current.promptPresets : []
  const [_, force] = React.useReducer(x=>x+1,0)

  // Defaults for new preset
  const defaultParams = {
    maxContextSize: 50000,
    maxOutputTokens: 8192,
    thinkingEnabled: true,
    thinkingTokens: 5000,
    temperatureEnabled: true,
    temperature: 1.0,
    topPEnabled: true,
    topP: 0.95,
  }
  const buildDefaultBlocks = (): PromptBlock[] => {
    const now = Date.now()
    const rid = (s: string) => `block-${now}-${Math.random().toString(36).slice(2)}-${s}`
    return [
      { id: rid('sys'), name: '시스템 프롬프트', type: 'system', role: 'system', prompt: '# Persona\nLet\'s start role playing. From now on, you are {{char}}.\n\n# Rules\n- Speak Korean only.\n- Keep responses concise (2~4 sentences) unless asked otherwise.\n- Do not use markdown or emoji, and avoid () or [] brackets.' },
      { id: rid('user-role'), name: '페르소나 프롬프트', type: 'pure', role: 'user', prompt: '# User Role\nUser is {{user}}\n\n## User Description\n{{user_description}}' },
      { id: rid('ai-role'), name: '캐릭터 프롬프트', type: 'pure', role: 'user', prompt: '# AI Role\nAI is {{char}}\n\n## AI Description\n{{char_description}}\n---' },
      { id: rid('lore-start'), name: '로어북 시작', type: 'pure', role: 'user', prompt: '# Lore\n--- Lore Start ---' },
      { id: rid('lore'), name: '로어북', type: 'lorebook', role: 'user', prompt: '' },
      { id: rid('lore-end'), name: '로어북 끝', type: 'pure', role: 'user', prompt: '--- Lore End ---' },
      { id: rid('chat-start'), name: '대화 시작', type: 'pure', role: 'user', prompt: '# Chat Log\n\n--- Chat Log Start ---' },
      { id: rid('conv'), name: '대화 이력', type: 'conversation', role: 'user', prompt: '', count: 10 },
      { id: rid('chat-end'), name: '대화 끝', type: 'pure', role: 'user', prompt: '--- Chat Log End ---' },
      { id: rid('go'), name: '글로벌 노트 덮어쓰기', type: 'global_override', role: 'user', prompt: '' },
      { id: rid('final-insert'), name: '최종 삽입', type: 'final_insert', role: 'user', prompt: '' },
      { id: rid('author-notes'), name: '작가의 노트', type: 'author_notes', role: 'user', prompt: '' },
      { id: rid('user-input'), name: '유저 입력', type: 'pure', role: 'user', prompt: '# User Input\n```\n{{user_input}}\n```' },
    ]
  }

  const saveCurrentAsPreset = async () => {
    try {
      try { promptCommitRef.current?.() } catch {}
      await new Promise(res => setTimeout(res, 0))
      const name = prompt('프리셋 이름을 입력하세요', '새 프리셋') || '새 프리셋'
      const cfg = cfgRef.current || {}
      const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const params = {
        maxContextSize: cfg.maxContextSize,
        maxOutputTokens: cfg.maxOutputTokens,
        thinkingEnabled: cfg.thinkingEnabled,
        thinkingTokens: cfg.thinkingTokens,
        temperatureEnabled: cfg.temperatureEnabled,
        temperature: cfg.temperature,
        topPEnabled: cfg.topPEnabled,
        topP: cfg.topP,
      }
      const blocks = (localBlocksRef.current || []).map(b => ({ ...b }))
      const scripts = (scriptsRef.current || []).map((s: any) => ({ ...s }))
      const preset: Preset = { id, name, createdAt: Date.now(), params, promptBlocks: blocks, regexScripts: scripts }
      const next = [...presets, preset]
      setCfg((p: any) => ({ ...p, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      setSelectedId(id)
      pushToast('현재 값을 프리셋으로 저장했습니다', 'success')
      force()
    } catch { pushToast('프리셋 저장 실패', 'error') }
  }

  const createNewPreset = async () => {
    try {
      const cfg = cfgRef.current || {}
      const name = '새 프리셋'
      const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const preset: Preset = {
        id,
        name,
        createdAt: Date.now(),
        params: defaultParams,
        promptBlocks: buildDefaultBlocks(),
        regexScripts: []
      }
      const next = [...presets, preset]
      setCfg((p: any) => ({ ...p, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      setSelectedId(id)
      force()
    } catch { pushToast('새 프리셋 생성 실패', 'error') }
  }

  const renameSelected = async () => {
    const sid = selectedId
    if (!sid) { pushToast('선택된 프리셋이 없습니다', 'error'); return }
    const newName = prompt('새 이름', presets.find(p=>p.id===sid)?.name || '프리셋')
    if (!newName) return
    try {
      const cfg = cfgRef.current || {}
      const next = (presets || []).map(p => p.id===sid ? { ...p, name: newName } : p)
      setCfg((pr:any)=>({ ...pr, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      pushToast('이름을 변경했습니다', 'success')
      force()
    } catch { pushToast('이름 변경 실패', 'error') }
  }

  const duplicatePreset = async (p: Preset) => {
    try {
      const cfg = cfgRef.current || {}
      const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const name = `${p.name || '프리셋'} copy`
      const copy: Preset = { id, name, createdAt: Date.now(), params: { ...p.params }, promptBlocks: (p.promptBlocks||[]).map(b=>({ ...b })), regexScripts: (p.regexScripts||[]).map((s:any)=>({ ...s })) }
      const next = [...presets, copy]
      setCfg((pr:any)=>({ ...pr, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      setSelectedId(id)
      pushToast('프리셋을 복제했습니다', 'success')
      force()
    } catch { pushToast('복제 실패', 'error') }
  }

  const exportPreset = (p: Preset) => {
    try {
      const data = { type: 'aiVoiceDating-preset', version: 1, name: p.name, createdAt: p.createdAt, payload: { params: p.params, promptBlocks: p.promptBlocks, regexScripts: p.regexScripts } }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = (p.name || 'preset').replace(/[^\w\-가-힣\s]+/g, '_').trim().replace(/\s+/g,' ')
      a.download = `${safeName}.aivdp`
      a.click()
      URL.revokeObjectURL(url)
      pushToast('프리셋을 내보냈습니다', 'success')
    } catch { pushToast('내보내기 실패', 'error') }
  }

  const removePreset = async (id: string) => {
    try {
      const cfg = cfgRef.current || {}
      const next = (presets || []).filter(p => p.id !== id)
      setCfg((pr:any)=>({ ...pr, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      if (selectedId === id) setSelectedId(null)
      pushToast('프리셋을 삭제했습니다', 'success')
      force()
    } catch { pushToast('삭제 실패', 'error') }
  }

  const applyPreset = async (p: Preset) => {
    try {
      // 커밋 중단(현 상태 보존) -> 프리셋 값 적용
      const cfg = cfgRef.current || {}
      const params = p.params || {}
      const nextCfg = { ...cfg, ...params, regexScripts: Array.isArray(p.regexScripts) ? p.regexScripts : [] }
      setCfg(nextCfg)
      await idbSetSettings(nextCfg)
      // Blocks 적용 및 저장
      const blocks = Array.isArray(p.promptBlocks) ? p.promptBlocks : []
      setLocalBlocks(blocks)
      await autoSaveBlocks(blocks)
      // Scripts 적용 및 저장
      setScripts(Array.isArray(p.regexScripts) ? p.regexScripts : [])
      await autoSaveScripts(Array.isArray(p.regexScripts) ? p.regexScripts : [])
      setSelectedId(p.id)
      pushToast('프리셋을 적용했습니다', 'success')
      force()
    } catch (e) {
      console.error(e)
      pushToast('프리셋 적용 실패', 'error')
    }
  }

  const onImportClick = () => fileInputRef.current?.click()
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      if (!json || json.type !== 'aiVoiceDating-preset' || !json.payload) throw new Error('invalid')
      const cfg = cfgRef.current || {}
      const payload = json.payload || {}
      const name = String(json.name || file.name.replace(/\.aivdp$/i, '') || 'Imported Preset')
      const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const preset: Preset = { id, name, createdAt: Date.now(), params: payload.params || {}, promptBlocks: Array.isArray(payload.promptBlocks)?payload.promptBlocks:[], regexScripts: Array.isArray(payload.regexScripts)?payload.regexScripts:[] }
      const next = [...presets, preset]
      setCfg((pr:any)=>({ ...pr, promptPresets: next }))
      await idbSetSettings({ ...cfg, promptPresets: next })
      setSelectedId(id)
      pushToast('프리셋을 가져왔습니다', 'success')
      force()
    } catch (e) {
      console.error(e)
      pushToast('가져오기 실패: 파일 형식 오류', 'error')
    } finally { e.target.value = '' }
  }

  return (
  <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-slate-300 font-semibold">프리셋</div>
        <button onClick={saveCurrentAsPreset} className="px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs">현재값 저장</button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {(!presets || presets.length===0) ? (
          <div className="text-xs text-slate-400">저장된 프리셋이 없습니다.</div>
        ) : (
          presets.map((p, idx) => {
            const active = selectedId === p.id
            return (
              <div key={p.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${active? 'border-teal-500/60 bg-slate-800/60':'border-slate-700/50 bg-slate-900/40'}` }>
                <button onClick={()=>applyPreset(p)} className="flex items-center gap-3 text-left min-w-0 flex-1">
                  <div className="w-5 text-slate-400 text-xs">{idx+1}</div>
                  <div className="min-w-0">
                    <div className="text-slate-200 text-sm font-medium truncate" title={p.name}>{p.name}</div>
                    <div className="text-slate-500 text-[11px] truncate">{new Date(p.createdAt).toLocaleString()}</div>
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button title="복제" onClick={()=>duplicatePreset(p)} className="p-1.5 rounded bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" aria-label="복제">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                  <button title="내보내기" onClick={()=>exportPreset(p)} className="p-1.5 rounded bg-slate-700/60 hover:bg-slate-600/70 text-slate-200" aria-label="내보내기">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>
                  </button>
                  <button title="삭제" onClick={()=>removePreset(p.id)} className="p-1.5 rounded bg-red-600/80 hover:bg-red-500 text-white" aria-label="삭제">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Bottom bar */}
      <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center gap-2">
        <input ref={fileInputRef} type="file" accept=".aivdp,application/json" className="hidden" onChange={onFileChange} />
        <button title="새 프리셋" onClick={createNewPreset} className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 text-sm" aria-label="새 프리셋">+</button>
        <button title="가져오기" onClick={onImportClick} className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 text-sm" aria-label="가져오기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>
        </button>
        <button title="이름 변경" onClick={renameSelected} className="px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600/70 text-slate-200 text-sm" aria-label="이름 변경">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
      </div>
    </section>
  )
}
