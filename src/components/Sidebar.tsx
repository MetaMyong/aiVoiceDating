import React from 'react'

export default function Sidebar(){
  return (
    <aside className="sidebar hidden md:block">
      <div className="brand flex items-center gap-2">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="12" r="5" fill="#f97316" />
          <path d="M16 18 C10 18 8 22 8 26 L24 26 C24 22 22 18 16 18 Z" fill="#f97316" />
          <path d="M12 10 Q12 6 16 6 Q20 6 20 10" stroke="#fb923c" strokeWidth="1.5" fill="none" />
          <circle cx="14" cy="11" r="1" fill="white" />
          <circle cx="18" cy="11" r="1" fill="white" />
        </svg>
        <span>aiVoiceDating</span>
      </div>
      <div className="conversations">
        {/* conversation list (populated later) */}
      </div>
      {/* Settings moved to floating button */}
    </aside>
  )
}
