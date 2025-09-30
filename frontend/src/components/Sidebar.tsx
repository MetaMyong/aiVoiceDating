import React from 'react'

export default function Sidebar(){
  return (
    <aside className="sidebar hidden md:block">
      <div className="brand">aiDate</div>
      <div className="conversations">
        {/* conversation list (populated later) */}
      </div>
      {/* Settings moved to floating button */}
    </aside>
  )
}
