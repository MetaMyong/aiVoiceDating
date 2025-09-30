import React from 'react'
import Chat from './components/Chat'
import Sidebar from './components/Sidebar'
import SettingsPage from './pages/SettingsPage'
import ToastContainer from './components/Toast'

export default function App(){
  return (
    <div className="app justify-center">
        {window.location.pathname === '/settings' ? (
          <SettingsPage />
        ) : (
          <>
            <Sidebar />
            <Chat />
          </>
        )}
  {window.location.pathname !== '/settings' && (
          <button aria-label="Settings" title="Settings" className="fixed right-6 top-4 w-10 h-10 rounded-full bg-white border shadow flex items-center justify-center" onClick={()=>{ window.location.href = '/settings'; }}>
            {/* silhouette gear cluster (solid) */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" className="text-gray-700">
              <path d="M19.4 13.3c.1-.6.1-1.2.1-1.8s0-1.2-.1-1.8l2-1.6c.2-.2.2-.5.1-.8l-1.9-3.3c-.1-.3-.4-.4-.7-.3l-2.4 1c-.5-.4-1-.7-1.6-.9L14.6.6c0-.3-.3-.5-.6-.5h-3.9c-.3 0-.6.2-.6.5L9 4.1c-.6.2-1.2.5-1.6.9L5 3.9c-.3-.1-.6 0-.7.3L2.4 7.5c-.1.3-.1.6.1.8l2 1.6c-.1.6-.1 1.2-.1 1.8s0 1.2.1 1.8l-2 1.6c-.2.2-.2.5-.1.8l1.9 3.3c.1.3.4.4.7.3l2.4-1c.5.4 1 .7 1.6.9l.2 3.5c0 .3.3.5.6.5h3.9c.3 0 .6-.2.6-.5l.2-3.5c.6-.2 1.1-.5 1.6-.9l2.4 1c.3.1.6 0 .7-.3l1.9-3.3c.1-.3.1-.6-.1-.8l-2-1.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
            </svg>
          </button>
        )}
  <ToastContainer />
    </div>
  )
}
