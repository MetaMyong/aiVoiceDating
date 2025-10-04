import React from 'react'
import { getSettings } from './lib/indexeddb'
import Chat from './components/Chat'
import Sidebar from './components/Sidebar'
import SettingsPage from './pages/SettingsPage'
import ToastContainer from './components/Toast'

export default function App(){
  const [hasSelectedCard, setHasSelectedCard] = React.useState<boolean>(false)
  const [showMobileSidebar, setShowMobileSidebar] = React.useState<boolean>(false)

  React.useEffect(() => {
    const check = async () => {
      try {
        const cfg = await getSettings()
        const idx = cfg?.selectedCharacterCardIndex
        setHasSelectedCard(typeof idx === 'number')
      } catch {}
    }
    check()
    const onChange = () => check()
    window.addEventListener('characterSelectionChanged', onChange as any)
    window.addEventListener('characterCardsUpdate', onChange as any)
    return () => {
      window.removeEventListener('characterSelectionChanged', onChange as any)
      window.removeEventListener('characterCardsUpdate', onChange as any)
    }
  }, [])

  return (
    <div className="app justify-center">
        {window.location.pathname === '/settings' ? (
          <SettingsPage />
        ) : (
          <>
            {/* 모바일 메뉴 버튼 */}
            <button
              onClick={() => setShowMobileSidebar(true)}
              className="md:hidden fixed top-4 left-4 z-40 w-10 h-10 bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-lg flex items-center justify-center text-white hover:bg-slate-700/90 transition-colors shadow-lg"
              aria-label="메뉴 열기"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* 모바일 사이드바 오버레이 */}
            {showMobileSidebar && (
              <div
                className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
                onClick={() => setShowMobileSidebar(false)}
              >
                <div
                  className="w-80 h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 shadow-2xl overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="h-full flex flex-col">
                    <div className="flex items-center justify-between p-4 border-b border-slate-700/50">
                      <h2 className="text-white font-bold text-lg">캐릭터 선택</h2>
                      <button
                        onClick={() => setShowMobileSidebar(false)}
                        className="w-8 h-8 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <Sidebar onCardSelect={() => setShowMobileSidebar(false)} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Sidebar className="hidden md:flex" />
            {hasSelectedCard ? (
              <Chat />
            ) : (
              <div className="flex-1 min-h-screen grid place-items-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <div className="text-center space-y-6 px-4">
                  <div className="text-8xl mb-6 animate-bounce">💬</div>
                  <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-cyan-400">
                    AI Voice Dating에 오신 것을 환영합니다
                  </h2>
                  <p className="text-slate-400 max-w-md text-lg leading-relaxed">
                    왼쪽에서 캐릭터 카드를 선택하여<br/>
                    AI와의 음성 대화를 시작하세요
                  </p>
                  <div className="pt-4">
                    <div className="inline-flex items-center gap-2 text-teal-400 text-sm">
                      <svg className="w-5 h-5 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span>캐릭터를 선택해주세요</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
  <ToastContainer />
    </div>
  )
}
