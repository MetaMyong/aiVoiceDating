import React from 'react'
import { setSettings as idbSetSettings } from '../../lib/indexeddb'

export type PromptBlock = {
  id: string
  name: string
  type: 'pure' | 'conversation' | 'persona' | 'character' | 'longterm' | 'system'
  prompt?: string
  role: 'user' | 'assistant' | 'system'
  startIndex?: number
  endIndex?: number
  count?: number
}

export default function PromptSettings(props: any){
  const { cfg, setCfg, promptBlocks, setPromptBlocks, promptRightTab, expandedBlocks, setExpandedBlocks, dragIndexRef, promptLocalRef } = props

  const [localBlocks, setLocalBlocks] = React.useState<PromptBlock[]>(() =>
    (promptBlocks || []).map((b: any, i: number) => (b.id ? b : { ...b, id: `block-${Date.now()}-${i}-${Math.random()}` }))
  )
  // keep latest localBlocks for beforeunload/debounce
  const localBlocksRef = React.useRef<PromptBlock[]>([])
  React.useEffect(() => { localBlocksRef.current = localBlocks }, [localBlocks])
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
    const blocks = localBlocksRef.current
    if (!blocks) return
    isEditingRef.current = false
    autoSave(blocks)
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
        <section className="bg-white rounded shadow p-8">
          <div className="mb-3 flex justify-between items-center">
            <div className="text-sm text-gray-600">프롬프트 블록 편집</div>
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
                className="border rounded bg-gray-50"
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
                    <div className="text-sm font-medium">{b.name || '(이름 없음)'}</div>
                    <div className="text-xs text-gray-500">{b.type}</div>
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
                      className="drag-handle text-xs text-gray-400 cursor-move px-2 py-1 hover:bg-gray-200 rounded"
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
                    className="p-3 border-t bg-white"
                    onMouseDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    draggable={false}
                  >
                    <div className="mb-2">
                      <label className="block text-xs text-gray-600" htmlFor={`block-name-${b.id}`}>이름 (설명용)</label>
                      <input
                        id={`block-name-${b.id}`}
                        name={`block-name-${b.id}`}
                        className="w-full rounded border px-2 py-1"
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
                        <label className="block text-xs text-gray-600" htmlFor={`block-type-${b.id}`}>타입</label>
                        <select
                          id={`block-type-${b.id}`}
                          name={`block-type-${b.id}`}
                          className="w-full rounded border px-2 py-1"
                          value={b.type}
                          onChange={(e) => {
                            const val = e.target.value as PromptBlock['type']
                            if (val === 'conversation') {
                              updateBlockField(i, { type: 'conversation', prompt: '', name: '대화 이력', role: 'user', count: 10 })
                            } else if (val === 'system') {
                              updateBlockField(i, { type: 'system', name: '시스템 프롬프트', role: 'system' })
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
                          <option value="persona">페르소나 프롬프트</option>
                          <option value="character">캐릭터 프롬프트</option>
                          <option value="longterm">장기기억</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600" htmlFor={`block-role-${b.id}`}>역할 (role)</label>
                        <select
                          id={`block-role-${b.id}`}
                          name={`block-role-${b.id}`}
                          className="w-full rounded border px-2 py-1"
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
                            <label className="block text-xs text-gray-600" htmlFor={`start-${b.id}`}>시작 인덱스 (startIndex)</label>
                            <input
                              id={`start-${b.id}`}
                              name={`start-${b.id}`}
                              className="w-32 rounded border px-2 py-1"
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
                            <label className="block text-xs text-gray-600" htmlFor={`end-${b.id}`}>끝 인덱스 (endIndex)</label>
                            <input
                              id={`end-${b.id}`}
                              name={`end-${b.id}`}
                              className="w-32 rounded border px-2 py-1"
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
                        <div className="text-xs text-gray-500">startIndex와 endIndex는 대화 이력의 인덱스(0=가장 오래된). 예: startIndex=0, endIndex=9 는 처음부터 10개의 메시지를 포함합니다. 음수 인덱스는 지원되지 않습니다.</div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-600" htmlFor={`prompt-${b.id}`}>프롬프트 내용</label>
                        <textarea
                          id={`prompt-${b.id}`}
                          name={`prompt-${b.id}`}
                          className="w-full rounded border px-2 py-1 font-mono text-sm"
                          rows={6}
                          value={b.prompt}
                          onChange={(e) => {
                            updateBlockField(i, { prompt: e.target.value })
                          }}
                          draggable={false}
                          // save via header mousedown
                        />
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
        <section className="bg-white rounded shadow p-8">
          <div className="text-sm text-gray-600 mb-4">LLM 생성 파라미터</div>
          <div className="grid grid-cols-1 gap-4">
            {/* 최대 콘텍스트 크기 */}
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="max-context">
                최대 콘텍스트 크기
              </label>
              <input
                id="max-context"
                name="max-context"
                type="number"
                min="1024"
                max="1000000"
                step="1024"
                className="w-full rounded border px-3 py-2"
                value={cfg.maxContextSize || 50000}
                onChange={(e) => {
                  const val = Math.max(1024, parseInt(e.target.value) || 50000);
                  setCfg({ ...cfg, maxContextSize: val });
                }}
                placeholder="50000"
              />
              <div className="text-xs text-gray-500 mt-1">
                모델이 처리할 수 있는 최대 토큰 수 (기본값: 50000)
              </div>
            </div>

            {/* 최대 응답 크기 */}
            <div>
              <label className="block text-xs text-gray-600 mb-1" htmlFor="max-output">
                최대 응답 크기
              </label>
              <input
                id="max-output"
                name="max-output"
                type="number"
                min="128"
                max="100000"
                step="128"
                className="w-full rounded border px-3 py-2"
                value={cfg.maxOutputTokens || 8192}
                onChange={(e) => {
                  const val = Math.max(128, parseInt(e.target.value) || 8192);
                  setCfg({ ...cfg, maxOutputTokens: val });
                }}
                placeholder="8192"
              />
              <div className="text-xs text-gray-500 mt-1">
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
                  className="rounded"
                />
                <label className="text-xs text-gray-600" htmlFor="thinking-enabled">
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
                  className="w-full rounded border px-3 py-2"
                  value={cfg.thinkingTokens || 5000}
                  onChange={(e) => {
                    const val = Math.max(0, parseInt(e.target.value) || 5000);
                    setCfg({ ...cfg, thinkingTokens: val });
                  }}
                  placeholder="5000"
                />
              )}
              <div className="text-xs text-gray-500 mt-1">
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
                  className="rounded"
                />
                <label className="text-xs text-gray-600" htmlFor="temperature-enabled">
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
                  className="w-full rounded border px-3 py-2"
                  value={cfg.temperature ?? 1.0}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(2, parseFloat(e.target.value) || 1.0));
                    setCfg({ ...cfg, temperature: val });
                  }}
                  placeholder="1.0"
                />
              )}
              <div className="text-xs text-gray-500 mt-1">
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
                  className="rounded"
                />
                <label className="text-xs text-gray-600" htmlFor="top-p-enabled">
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
                  className="w-full rounded border px-3 py-2"
                  value={cfg.topP ?? 0.95}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0.95));
                    setCfg({ ...cfg, topP: val });
                  }}
                  placeholder="0.95"
                />
              )}
              <div className="text-xs text-gray-500 mt-1">
                누적 확률 임계값 (0.0~1.0, 기본값: 0.95)
              </div>
            </div>
          </div>
        </section>
      )}
      {promptRightTab === 'other' && (<div className="text-sm text-gray-500">내보내기/가져오기는 추후 구현됩니다.</div>)}
    </div>
  )
}
