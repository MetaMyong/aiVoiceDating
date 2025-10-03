import React from 'react'

type Props = {
  onClick?: ()=>void,
  className?: string,
  title?: string,
}

export default function BackButton({onClick, className, title='뒤로가기'}: Props){
  return (
    <button type="button" title={title} onClick={onClick || (()=>window.history.back())} className={`w-10 h-10 rounded-full bg-white border shadow flex items-center justify-center z-30 ${className||''}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
  )
}
