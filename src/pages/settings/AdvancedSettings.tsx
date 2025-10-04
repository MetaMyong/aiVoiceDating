import React from 'react'

export default function AdvancedSettings(props:any){
  return (
    <div>
      <section className="bg-slate-800/50 rounded-lg shadow-lg border border-slate-700/50 p-8">
        <div className="grid grid-cols-1 gap-4">
          <div className="text-sm text-slate-300">고급 설정</div>
          <div className="text-xs text-slate-400">여기에 고급 설정 항목을 추가하세요.</div>
        </div>
      </section>
    </div>
  )
}
