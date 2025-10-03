import React from 'react'
import { setSettings as idbSetSettings } from '../../lib/indexeddb'
import { pushToast } from '../../components/Toast'

export default function PromptSettings(props: any){
  const { cfg, setCfg, promptBlocks, setPromptBlocks, promptRightTab, setPromptRightTab, expandedBlocks, setExpandedBlocks, dragIndexRef, promptLocalRef } = props;
  
  // Local editable copy - initialize immediately from props
  const [localBlocks, setLocalBlocks] = React.useState<any[]>(() =>
    promptBlocks.map((b: any, i: number) => (b.id ? b : { ...b, id: `block-${Date.now()}-${i}-${Math.random()}` }))
  );
  // Track local edits to avoid clobbering focus with parent updates
  const [dirty, setDirty] = React.useState(false);
  // Expose latest local to parent via ref for global Save button
  React.useEffect(() => {
    if (promptLocalRef) {
      promptLocalRef.current = localBlocks;
    }
  }, [localBlocks, promptLocalRef]);
  
  // Sync from parent when not dirty (e.g., after DB load)
  React.useEffect(() => {
    if (!dirty) {
      setLocalBlocks(
        promptBlocks.map((b: any, i: number) => (b.id ? b : { ...b, id: `block-${Date.now()}-${i}-${Math.random()}` }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptBlocks]);
  
  // Update handler for local blocks only
  const updateBlockField = (index: number, patch: any) => {
  setDirty(true);
    setLocalBlocks((prev: any[]) => {
      const arr = [...prev];
      arr[index] = { ...arr[index], ...patch };
      return arr;
    });
  };

  const removeBlock = (index: number) => {
  setDirty(true);
    setLocalBlocks((prev:any[]) => {
      const arr = [...prev]; 
      arr.splice(index,1); 
      return arr;
    });
  };

  const addBlock = () => {
  setDirty(true);
    setLocalBlocks((prev:any[]) => [...prev, { 
      name: '새 블록', 
      type: 'pure' as const, 
      prompt: '', 
      role: 'user' as const, 
      id: `block-${Date.now()}` 
    }]);
  };
  
  // Save handler - sync local to parent and persist
  const handleSave = async () => {
    setPromptBlocks(localBlocks);
    const newCfg = {...cfg, promptBlocks: localBlocks};
    setCfg(newCfg);
    try{ 
      await idbSetSettings(newCfg); 
      pushToast('프롬프트 블록 저장됨','success'); 
    }catch(e){ 
      pushToast('저장 실패','error'); 
    }
  };

  return (
    <div>
      {promptRightTab === 'blocks' && (
        <section className="bg-white rounded shadow p-8">
          <div className="mb-3 flex justify-between items-center">
            <div className="text-sm text-gray-600">프롬프트 블록 편집</div>
            <div className="flex gap-2">
              <button 
                type="button" 
                className="px-3 py-1 bg-green-500 text-white rounded" 
                onClick={addBlock}
              >
                블록 추가
              </button>
              <button 
                type="button" 
                className="px-3 py-1 bg-blue-500 text-white rounded" 
                onClick={handleSave}
              >
                저장
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {localBlocks.map((b:any,i:number)=> (
              <div 
                key={b.id} 
                className="border rounded bg-gray-50" 
                draggable 
                onDragStart={(e)=>{ 
                  dragIndexRef.current = i; 
                  e.dataTransfer!.effectAllowed = 'move'; 
                }} 
                onDragOver={(e)=>{ 
                  e.preventDefault(); 
                }} 
                onDrop={(e)=>{ 
                  e.preventDefault(); 
                  const from = dragIndexRef.current; 
                  const to = i; 
                  if(from==null) return; 
                  if(from===to) return; 
                  setDirty(true);
                  setLocalBlocks((prev:any[]) => {
                    const arr = [...prev];
                    const item = arr.splice(from,1)[0];
                    arr.splice(to,0,item);
                    return arr;
                  });
                  dragIndexRef.current = null; 
                }}
              >
                <div 
                  className="flex items-center justify-between px-3 py-2 cursor-pointer" 
                  onClick={()=>setExpandedBlocks((x:any)=>({...x, [b.id]: !x[b.id]}))}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-medium">{b.name||'(이름 없음)'}</div>
                    <div className="text-xs text-gray-500">{b.type}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      type="button" 
                      className="text-xs px-2 py-1 bg-gray-200 rounded" 
                      onClick={(e)=>{ 
                        e.stopPropagation(); 
                        // remove block and cleanup expanded state keyed by id
                        const id = b.id;
                        removeBlock(i);
                        setExpandedBlocks((prev:any)=>{ const copy = {...prev}; delete copy[id]; return copy; });
                      }}
                    >
                      삭제
                    </button>
                    <div className="text-xs text-gray-400">☰</div>
                  </div>
                </div>
                {expandedBlocks[b.id] && (
                  <div className="p-3 border-t bg-white">
                    <div className="mb-2">
                      <label className="block text-xs text-gray-600">이름 (설명용)</label>
                      <input 
                        className="w-full rounded border px-2 py-1" 
                        value={b.name} 
                        onChange={(e)=>{ updateBlockField(i, { name: e.target.value }); }} 
                      />
                    </div>
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600">타입</label>
                        <select 
                          className="w-full rounded border px-2 py-1" 
                          value={b.type} 
                          onChange={(e)=>{
                            const val = e.target.value as any;
                            if(val === 'conversation'){
                              updateBlockField(i, { type: 'conversation', prompt: '', name: '대화 이력', role: 'user', count: 10 });
                            } else {
                              updateBlockField(i, { type: val });
                            }
                          }}
                        >
                          <option value="pure">순수 프롬프트</option>
                          <option value="conversation">대화</option>
                          <option value="persona">페르소나 프롬프트</option>
                          <option value="character">캐릭터 프롬프트</option>
                          <option value="longterm">장기기억</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600">역할 (role)</label>
                        <select 
                          className="w-full rounded border px-2 py-1" 
                          value={b.role} 
                          onChange={(e)=>{ updateBlockField(i, { role: e.target.value as any }); }}
                        >
                          <option value="user">user</option>
                          <option value="assistant">assistant</option>
                        </select>
                      </div>
                    </div>
                    {b.type === 'conversation' ? (
                      <div>
                        <div className="mb-2 grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-600">시작 인덱스 (startIndex)</label>
                            <input 
                              className="w-32 rounded border px-2 py-1" 
                              type="number" 
                              min={0} 
                              value={b.startIndex ?? 0} 
                              onChange={(e)=>{ const v = Math.max(0, Number(e.target.value)||0); updateBlockField(i, { startIndex: v }); }} 
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600">끝 인덱스 (endIndex)</label>
                            <input 
                              className="w-32 rounded border px-2 py-1" 
                              type="number" 
                              min={0} 
                              value={b.endIndex ?? 0} 
                              onChange={(e)=>{ const v = Math.max(0, Number(e.target.value)||0); updateBlockField(i, { endIndex: v }); }} 
                            />
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          startIndex와 endIndex는 대화 이력의 인덱스(0=가장 오래된). 
                          예: startIndex=0, endIndex=9 는 처음부터 10개의 메시지를 포함합니다. 
                          음수 인덱스는 지원되지 않습니다.
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs text-gray-600">프롬프트 내용</label>
                        <textarea 
                          className="w-full rounded border px-2 py-1 font-mono text-sm" 
                          rows={6} 
                          value={b.prompt} 
                          onChange={(e)=>{ updateBlockField(i, { prompt: e.target.value }); }} 
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
        <div className="text-sm text-gray-500">파라미터 편집은 추후 구현됩니다.</div>
      )}
      {promptRightTab === 'other' && (
        <div className="text-sm text-gray-500">내보내기/가져오기는 추후 구현됩니다.</div>
      )}
    </div>
  )
}
