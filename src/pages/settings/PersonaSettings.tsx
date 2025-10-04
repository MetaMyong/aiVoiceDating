import React, { useState, useRef, useEffect } from 'react'
import { IconDownload, IconUpload, IconCamera, IconTrash, IconUser, IconCog } from '../../components/Icons'
import { pushToast } from '../../components/Toast'
import CharacterSidePanel from '../../components/CharacterSidePanel'
import { setSettings as idbSetSettings, getSettings as idbGetSettings } from '../../lib/indexeddb'

interface Persona {
  name: string
  description: string
  avatar: string // base64 or URL
  characterData?: any // 전체 character card 데이터
  ttsProvider?: string // 'none', 'gemini', 'fishaudio'
  ttsModel?: string // TTS 모델 ID
  ttsVoice?: string // Gemini TTS voice name (Gemini only)
}

export default function PersonaSettings(props: any) {
  const { cfg, setCfg } = props
  
  // Gemini voice options
  const geminiVoices: { value: string; label: string; gender?: string; desc?: string }[] = [
    { value: 'Achernar', label: 'Achernar', gender: '여성', desc: 'Soft · 여성' },
    { value: 'Achird', label: 'Achird', gender: '남성', desc: 'Friendly · 남성' },
    { value: 'Algenib', label: 'Algenib', gender: '남성', desc: 'Gravelly · 남성' },
    { value: 'Algieba', label: 'Algieba', gender: '남성', desc: 'Smooth · 남성' },
    { value: 'Alnilam', label: 'Alnilam', gender: '남성', desc: 'Firm · 남성' },
    { value: 'Aoede', label: 'Aoede', gender: '여성', desc: 'Breezy · 여성' },
    { value: 'Autonoe', label: 'Autonoe', gender: '여성', desc: 'Bright · 여성' },
    { value: 'Callirrhoe', label: 'Callirrhoe', gender: '여성', desc: 'Easy-going · 여성' },
    { value: 'Charon', label: 'Charon', gender: '남성', desc: 'Informative · 남성' },
    { value: 'Despina', label: 'Despina', gender: '여성', desc: 'Smooth · 여성' },
    { value: 'Enceladus', label: 'Enceladus', gender: '남성', desc: 'Breathy · 남성' },
    { value: 'Erinome', label: 'Erinome', gender: '여성', desc: 'Clear · 여성' },
    { value: 'Fenrir', label: 'Fenrir', gender: '남성', desc: 'Excitable · 남성' },
    { value: 'Gacrux', label: 'Gacrux', gender: '여성', desc: 'Mature · 여성' },
    { value: 'Iapetus', label: 'Iapetus', gender: '남성', desc: 'Clear · 남성' },
    { value: 'Kore', label: 'Kore', gender: '여성', desc: 'Firm · 여성' },
    { value: 'Laomedeia', label: 'Laomedeia', gender: '여성', desc: 'Upbeat · 여성' },
    { value: 'Leda', label: 'Leda', gender: '여성', desc: 'Youthful · 여성' },
    { value: 'Orus', label: 'Orus', gender: '남성', desc: 'Firm · 남성' },
    { value: 'Pulcherrima', label: 'Pulcherrima', gender: '여성', desc: 'Forward · 여성' },
    { value: 'Puck', label: 'Puck', gender: '남성', desc: 'Upbeat · 남성' },
    { value: 'Rasalgethi', label: 'Rasalgethi', gender: '남성', desc: 'Informative · 남성' },
    { value: 'Sadachbia', label: 'Sadachbia', gender: '여성', desc: 'Lively · 여성' },
    { value: 'Sadaltager', label: 'Sadaltager', gender: '남성', desc: 'Knowledgeable · 남성' },
    { value: 'Schedar', label: 'Schedar', gender: '남성', desc: 'Even · 남성' },
    { value: 'Sulafat', label: 'Sulafat', gender: '여성', desc: 'Warm · 여성' },
    { value: 'Umbriel', label: 'Umbriel', gender: '남성', desc: 'Easy-going · 남성' },
    { value: 'Vindemiatrix', label: 'Vindemiatrix', gender: '여성', desc: 'Gentle · 여성' },
    { value: 'Zephyr', label: 'Zephyr', gender: '여성', desc: 'Bright · 여성' },
    { value: 'Zubenelgenubi', label: 'Zubenelgenubi', gender: '남성', desc: 'Casual · 남성' }
  ]
  const [personas, setPersonas] = useState<Persona[]>(cfg?.personas || [])
  const [selectedIndex, setSelectedIndex] = useState<number>(cfg?.selectedPersonaIndex ?? 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [panelOpen, setPanelOpen] = useState(false)

  const selectedPersona = personas[selectedIndex] || null

  // cfg의 personas가 변경되면 로컬 상태 동기화 (외부에서 로드된 경우)
  useEffect(() => {
    if (cfg?.personas && JSON.stringify(cfg.personas) !== JSON.stringify(personas)) {
      setPersonas(cfg.personas)
    }
  }, [cfg?.personas])

  // cfg의 selectedPersonaIndex가 변경되면 로컬 상태 동기화 (외부에서 로드된 경우)
  useEffect(() => {
    if (typeof cfg?.selectedPersonaIndex === 'number' && cfg.selectedPersonaIndex !== selectedIndex) {
      setSelectedIndex(cfg.selectedPersonaIndex)
    }
  }, [cfg?.selectedPersonaIndex])

  // 선택된 인덱스가 변경되면 cfg 업데이트 (cfg는 의존성에서 제외하여 무한 루프 방지)
  useEffect(() => {
    setCfg((prev: any) => ({ ...prev, selectedPersonaIndex: selectedIndex }))
  }, [selectedIndex, setCfg])

  // personas 변경 시에도 cfg 업데이트
  useEffect(() => {
    setCfg((prev: any) => ({ ...prev, personas }))
  }, [personas, setCfg])

  // PNG에서 Character Card 데이터 추출
  async function extractCharacterCard(file: File): Promise<any> {
    try {
      const buffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(buffer)
      
      // PNG 시그니처 확인
      if (uint8[0] !== 0x89 || uint8[1] !== 0x50 || uint8[2] !== 0x4E || uint8[3] !== 0x47) {
        throw new Error('유효한 PNG 파일이 아닙니다')
      }

      let pos = 8 // PNG 헤더 이후
      while (pos < uint8.length) {
        // 청크 길이 읽기
        const length = (uint8[pos] << 24) | (uint8[pos + 1] << 16) | (uint8[pos + 2] << 8) | uint8[pos + 3]
        pos += 4

        // 청크 타입 읽기
        const type = String.fromCharCode(uint8[pos], uint8[pos + 1], uint8[pos + 2], uint8[pos + 3])
        pos += 4

        // tEXt 청크에서 캐릭터 데이터 찾기 (ccv3, chara, persona 등)
        if (type === 'tEXt') {
          let keyEnd = pos
          while (keyEnd < pos + length && uint8[keyEnd] !== 0) {
            keyEnd++
          }
          const key = String.fromCharCode(...Array.from(uint8.slice(pos, keyEnd)))
          
          // 'ccv3' (RisuAI chara_card_v3), 'chara' 또는 'persona' 키 지원
          if (key === 'ccv3' || key === 'chara' || key === 'persona') {
            const dataStart = keyEnd + 1
            const dataEnd = pos + length
            const data = uint8.slice(dataStart, dataEnd)
            
            // base64 문자열을 latin1로 읽기 (base64는 ASCII 범위)
            const base64Text = new TextDecoder('latin1').decode(data)
            
            try {
              // base64 디코딩
              const binaryString = atob(base64Text)
              
              // UTF-8 바이트 배열로 변환
              const bytes = new Uint8Array(binaryString.length)
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i)
              }
              
              // UTF-8로 디코딩
              const decoded = new TextDecoder('utf-8').decode(bytes)
              const json = JSON.parse(decoded)
              console.log(`${key} 데이터 추출 성공:`, json)
              return json
            } catch (e) {
              console.warn(`${key} 데이터 파싱 실패:`, e)
              // 파싱 실패 시에도 계속 탐색
            }
          }
        }

        pos += length + 4 // 데이터 + CRC
        
        // IEND 도달 시 종료
        if (type === 'IEND') break
      }

      return null
    } catch (e) {
      console.error('Character card 추출 실패:', e)
      return null
    }
  }

  // 캐릭터 카드 임포트
  async function handleImportCard() {
    fileInputRef.current?.click()
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const characterData = await extractCharacterCard(file)
      
      if (!characterData) {
        pushToast('캐릭터 카드 데이터를 찾을 수 없습니다', 'error')
        return
      }

      // 이미지를 base64로 변환
      const reader = new FileReader()
      reader.onload = (event) => {
        const base64 = event.target?.result as string
        
        // 다양한 형식 지원
        let name = '이름 없음'
        let description = ''
        if (characterData?.spec === 'chara_card_v3' && characterData?.data) {
          name = characterData.data.name || '이름 없음'
          description = characterData.data.description || characterData.data.personality || ''
        } else {
          name = characterData.name || characterData.char_name || '이름 없음'
          description = characterData.description || characterData.personaPrompt || characterData.personality || ''
        }

        const newPersona: Persona = { name, description, avatar: base64, characterData }

        const updated = [...personas, newPersona]
        setPersonas(updated)
        setSelectedIndex(updated.length - 1)
        // Persist immediately to avoid rollback on later global save merges
        ;(async ()=>{
          try{
            const latest = await idbGetSettings()
            await idbSetSettings({ ...(latest||{}), personas: updated, selectedPersonaIndex: updated.length - 1 })
          }catch(e){ /* non-fatal */ }
        })()
        
        pushToast(`"${newPersona.name}" 캐릭터 카드를 불러왔습니다`, 'success')
      }
      reader.readAsDataURL(file)
    } catch (e) {
      console.error('파일 처리 실패:', e)
      pushToast('파일 처리 중 오류가 발생했습니다', 'error')
    }

    // 입력 초기화
    e.target.value = ''
  }

  // 캐릭터 카드 익스포트
  async function handleExportCard() {
    if (!selectedPersona) {
      pushToast('선택된 페르소나가 없습니다', 'error')
      return
    }

    try {
      // characterData가 있으면 사용, 없으면 현재 페르소나 정보로 생성
      const exportData = selectedPersona.characterData || {
        name: selectedPersona.name,
        personaPrompt: selectedPersona.description,
        note: ''
      }
      
      // JSON을 base64로 인코딩
      const json = JSON.stringify(exportData)
      const base64Data = btoa(unescape(encodeURIComponent(json))) // UTF-8 지원

      // 아바타 이미지 가져오기
      const avatarData = selectedPersona.avatar
      if (!avatarData || !avatarData.startsWith('data:image/')) {
        pushToast('유효한 이미지가 없습니다', 'error')
        return
      }

      // base64에서 실제 데이터 추출
      const base64Image = avatarData.split(',')[1]
      const binaryImage = atob(base64Image)
      const uint8 = new Uint8Array(binaryImage.length)
      for (let i = 0; i < binaryImage.length; i++) {
        uint8[i] = binaryImage.charCodeAt(i)
      }

  // tEXt 청크 생성 (ccv3 또는 persona 키 사용)
  const keyword = (exportData?.spec === 'chara_card_v3') ? 'ccv3' : 'persona'
      const keywordBytes = new TextEncoder().encode(keyword)
      const dataBytes = new TextEncoder().encode(base64Data)
      const chunkData = new Uint8Array(keywordBytes.length + 1 + dataBytes.length)
      chunkData.set(keywordBytes, 0)
      chunkData[keywordBytes.length] = 0 // null separator
      chunkData.set(dataBytes, keywordBytes.length + 1)

      // PNG에 tEXt 청크 삽입 (IEND 전에)
      const iendPos = findIENDPosition(uint8)
      if (iendPos === -1) {
        pushToast('PNG 파일 형식이 올바르지 않습니다', 'error')
        return
      }

      const newPNG = new Uint8Array(iendPos + 4 + 4 + chunkData.length + 4 + (uint8.length - iendPos))
      newPNG.set(uint8.slice(0, iendPos), 0)

      // tEXt 청크 쓰기
      let pos = iendPos
      // 길이
      const length = chunkData.length
      newPNG[pos++] = (length >> 24) & 0xFF
      newPNG[pos++] = (length >> 16) & 0xFF
      newPNG[pos++] = (length >> 8) & 0xFF
      newPNG[pos++] = length & 0xFF
      // 타입
      newPNG[pos++] = 't'.charCodeAt(0)
      newPNG[pos++] = 'E'.charCodeAt(0)
      newPNG[pos++] = 'X'.charCodeAt(0)
      newPNG[pos++] = 't'.charCodeAt(0)
      // 데이터
      newPNG.set(chunkData, pos)
      pos += chunkData.length
      // CRC
      const crc = calculateCRC(newPNG.slice(iendPos + 4, pos))
      newPNG[pos++] = (crc >> 24) & 0xFF
      newPNG[pos++] = (crc >> 16) & 0xFF
      newPNG[pos++] = (crc >> 8) & 0xFF
      newPNG[pos++] = crc & 0xFF

      // IEND 복사
      newPNG.set(uint8.slice(iendPos), pos)

      // 다운로드
      const blob = new Blob([newPNG], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedPersona.name || 'character'}_export.png`
      a.click()
      URL.revokeObjectURL(url)

      pushToast(`"${selectedPersona.name}" 캐릭터 카드를 익스포트했습니다`, 'success')
    } catch (e) {
      console.error('익스포트 실패:', e)
      pushToast('익스포트 중 오류가 발생했습니다: ' + (e as Error).message, 'error')
    }
  }

  function findIENDPosition(data: Uint8Array): number {
    for (let i = data.length - 12; i >= 8; i--) {
      if (data[i + 4] === 'I'.charCodeAt(0) &&
          data[i + 5] === 'E'.charCodeAt(0) &&
          data[i + 6] === 'N'.charCodeAt(0) &&
          data[i + 7] === 'D'.charCodeAt(0)) {
        return i
      }
    }
    return -1
  }

  function calculateCRC(data: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0)
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  // 아바타 이미지 변경
  async function handleChangeAvatar() {
    avatarInputRef.current?.click()
  }

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      
      if (selectedPersona) {
        const updated = [...personas]
        updated[selectedIndex] = { ...selectedPersona, avatar: base64 }
        setPersonas(updated)
        pushToast('아바타를 변경했습니다', 'success')
      }
    }
    reader.readAsDataURL(file)

    e.target.value = ''
  }

  // 새 페르소나 생성
  function handleCreatePersona() {
    const newPersona: Persona = {
      name: '새 페르소나',
      description: '여기에 설명을 입력하세요.',
      avatar: ''
    }
    const updated = [...personas, newPersona]
    setPersonas(updated)
    setSelectedIndex(updated.length - 1)
  }

  // 페르소나 삭제
  function handleDeletePersona() {
    if (!selectedPersona) return
    if (!confirm(`"${selectedPersona.name}"을(를) 삭제하시겠습니까?`)) return

    const updated = personas.filter((_, i) => i !== selectedIndex)
    setPersonas(updated)
    setSelectedIndex(Math.max(0, selectedIndex - 1))
    pushToast('페르소나를 삭제했습니다', 'success')
  }

  // 페르소나 정보 업데이트
  function updatePersonaName(name: string) {
    if (!selectedPersona) return
    const updated = [...personas]
    updated[selectedIndex] = { ...selectedPersona, name }
    setPersonas(updated)
  }

  function updatePersonaDescription(description: string) {
    if (!selectedPersona) return
    const updated = [...personas]
    updated[selectedIndex] = { ...selectedPersona, description }
    setPersonas(updated)
  }

  function updatePersonaTTSProvider(provider: string) {
    if (!selectedPersona) return
    const updated = [...personas]
    updated[selectedIndex] = { ...selectedPersona, ttsProvider: provider }
    setPersonas(updated)
  }

  function updatePersonaTTSModel(model: string) {
    if (!selectedPersona) return
    const updated = [...personas]
    updated[selectedIndex] = { ...selectedPersona, ttsModel: model }
    setPersonas(updated)
  }

  function updatePersonaTTSVoice(voice: string) {
    if (!selectedPersona) return
    const updated = [...personas]
    updated[selectedIndex] = { ...selectedPersona, ttsVoice: voice }
    setPersonas(updated)
  }

  function applyPersonaFromPanel(updatedPersona: Persona) {
    const updated = [...personas]
    updated[selectedIndex] = { ...updatedPersona }
    console.log('[PersonaSettings] applyPersonaFromPanel called with:', updatedPersona)
    console.log('[PersonaSettings] characterTTS in characterData:', updatedPersona.characterData?.data?.extensions?.characterTTS)
    setPersonas(updated)
    // Update parent cfg state immediately
    setCfg((prev: any) => ({ ...prev, personas: updated, selectedPersonaIndex: selectedIndex }))
    // Also persist panel changes immediately
    ;(async ()=>{
      try{
        const latest = await idbGetSettings()
        await idbSetSettings({ ...(latest||{}), personas: updated, selectedPersonaIndex: selectedIndex })
        console.log('[PersonaSettings] Saved to IndexedDB:', { personas: updated })
      }catch(e){
        console.error('[PersonaSettings] Failed to save to IndexedDB:', e)
      }
    })()
  }

  return (
    <div className="space-y-6">
      {/* 페르소나 갤러리 - 프리미엄 글래스모픽 디자인 */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 via-transparent to-cyan-500/5 pointer-events-none" />
        
        <div className="relative flex items-center justify-between mb-8">
          <div>
            <h3 className="text-3xl font-bold bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-400 bg-clip-text text-transparent mb-2">
              페르소나 갤러리
            </h3>
            {selectedPersona && (
              <p className="text-sm text-slate-400">
                현재 선택: <span className="text-teal-400 font-semibold">{selectedPersona.name}</span>
              </p>
            )}
          </div>
          <div className="flex gap-3">
            {selectedPersona && (
              <button
                onClick={()=>setPanelOpen(true)}
                className="group relative px-5 py-2.5 bg-gradient-to-r from-slate-700/90 to-slate-600/90 hover:from-slate-600 hover:to-slate-500 text-slate-100 text-sm font-semibold rounded-xl shadow-lg shadow-slate-700/30 hover:shadow-slate-600/50 transition-all duration-300 overflow-hidden"
              >
                <span className="relative z-10 flex items-center gap-2">
                  <IconCog className="w-5 h-5" /> 편집
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-slate-400/0 via-slate-400/10 to-slate-400/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
              </button>
            )}
            <button
              onClick={handleImportCard}
              className="group relative px-5 py-2.5 bg-gradient-to-r from-blue-600/90 to-blue-500/90 hover:from-blue-500 hover:to-blue-400 text-slate-100 text-sm font-semibold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-400/50 transition-all duration-300 overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-2">
                <IconDownload className="w-5 h-5" /> 임포트
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-blue-400/20 to-blue-400/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
            </button>
            <button
              onClick={handleExportCard}
              disabled={!selectedPersona}
              className="group relative px-5 py-2.5 bg-gradient-to-r from-green-600/90 to-green-500/90 hover:from-green-500 hover:to-green-400 text-slate-100 text-sm font-semibold rounded-xl shadow-lg shadow-green-500/30 hover:shadow-green-400/50 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-green-500/30 overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-2">
                <IconUpload className="w-5 h-5" /> 익스포트
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-green-400/0 via-green-400/20 to-green-400/0 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-700" />
            </button>
          </div>
        </div>

        <div className="relative grid grid-cols-6 gap-5">
          {personas.map((persona, idx) => (
            <div
              key={idx}
              onClick={() => setSelectedIndex(idx)}
              className={`group cursor-pointer rounded-2xl overflow-hidden transition-all duration-300 transform hover:scale-105 ${
                idx === selectedIndex
                  ? 'ring-4 ring-teal-500 shadow-2xl shadow-teal-500/50 scale-105'
                  : 'ring-2 ring-slate-700/50 hover:ring-teal-500/50 shadow-lg hover:shadow-xl'
              }`}
            >
              <div className="relative aspect-square bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center overflow-hidden">
                {persona.avatar ? (
                  <>
                    <img
                      src={persona.avatar}
                      alt={persona.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="absolute bottom-0 left-0 right-0 p-3 text-slate-100 font-semibold text-sm truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-2 group-hover:translate-y-0">
                      {persona.name}
                    </div>
                  </>
                ) : (
                  <div className="text-slate-600 group-hover:text-slate-500 group-hover:scale-110 transition-all duration-300">
                    <IconUser className="w-16 h-16" />
                  </div>
                )}
              </div>
            </div>
          ))}
          
          <div
            onClick={handleCreatePersona}
            className="group aspect-square rounded-2xl border-2 border-dashed border-slate-700/50 hover:border-teal-500 cursor-pointer flex items-center justify-center bg-gradient-to-br from-slate-900/30 to-slate-800/20 hover:from-teal-900/20 hover:to-cyan-900/20 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
          >
            <span className="text-6xl text-slate-600 group-hover:text-teal-400 transition-all duration-300 group-hover:scale-110">+</span>
          </div>
        </div>
      </section>

      {/* 선택된 페르소나 상세 - 프리미엄 디자인 */}
      {selectedPersona && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-700/50 p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-teal-500/5 pointer-events-none" />
          
          <div className="relative flex gap-8">
            <div className="flex-shrink-0 space-y-5">
              <div
                onClick={handleChangeAvatar}
                className="group relative w-72 h-72 rounded-2xl overflow-hidden border-4 border-slate-700/50 hover:border-teal-500 cursor-pointer transition-all duration-300 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-2xl hover:shadow-teal-500/30"
                title="클릭하여 이미지 변경"
              >
                {selectedPersona.avatar ? (
                  <>
                    <img
                      src={selectedPersona.avatar}
                      alt={selectedPersona.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-sm">
                      <span className="text-slate-100 text-xl font-bold flex items-center gap-2">
                        <IconCamera className="w-5 h-5" /> 변경하기
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="text-slate-600 text-9xl group-hover:text-slate-500 group-hover:scale-110 transition-all duration-300">?</div>
                )}
              </div>
              
              {/* 페르소나 TTS 설정 - 좌측으로 이동 */}
              <div className="space-y-3 bg-slate-800/30 p-4 rounded-xl border border-slate-700/50">
                <label className="flex text-sm font-bold text-slate-300 items-center gap-2">
                  <span className="text-purple-400">🔊</span> 페르소나 TTS
                </label>
                
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2">TTS 제공자</label>
                  <select
                    value={selectedPersona.ttsProvider || 'none'}
                    onChange={(e) => updatePersonaTTSProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800/60 border-2 border-slate-700/50 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200"
                  >
                    <option value="none">사용안함</option>
                    <option value="gemini">Gemini (Google)</option>
                    <option value="fishaudio">FishAudio</option>
                  </select>
                </div>

                {selectedPersona.ttsProvider === 'gemini' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-2">TTS 모델</label>
                      <select
                        value={selectedPersona.ttsModel || 'gemini-2.5-flash-preview-tts'}
                        onChange={(e) => updatePersonaTTSModel(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800/60 border-2 border-slate-700/50 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200"
                      >
                        <option value="gemini-2.5-flash-preview-tts">gemini-2.5-flash-preview-tts</option>
                        <option value="gemini-2.5-pro-preview-tts">gemini-2.5-pro-preview-tts</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-2">음성</label>
                      <select
                        value={selectedPersona.ttsVoice || 'Zephyr'}
                        onChange={(e) => updatePersonaTTSVoice(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-800/60 border-2 border-slate-700/50 rounded-lg text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200"
                      >
                        {geminiVoices.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label} {v.desc ? `(${v.desc})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {selectedPersona.ttsProvider === 'fishaudio' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-2">FishAudio 모델 ID</label>
                    <input
                      type="text"
                      value={selectedPersona.ttsModel || ''}
                      onChange={(e) => updatePersonaTTSModel(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-800/60 border-2 border-slate-700/50 rounded-lg text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200"
                      placeholder="FishAudio 모델 ID 입력"
                    />
                  </div>
                )}
              </div>
              
              <button
                onClick={handleDeletePersona}
                className="w-full px-5 py-3.5 bg-gradient-to-r from-red-600/90 to-red-500/90 hover:from-red-500 hover:to-red-400 text-slate-100 font-bold rounded-xl shadow-lg shadow-red-500/30 hover:shadow-red-400/50 transition-all duration-300 flex items-center justify-center gap-2"
              >
                <IconTrash className="w-5 h-5" /> 삭제
              </button>
            </div>

            <div className="flex-1 space-y-6">
              <div>
                <label className="flex text-sm font-bold text-slate-300 mb-3 items-center gap-2">
                  <span className="text-teal-400">✨</span> 이름
                </label>
                <input
                  type="text"
                  value={selectedPersona.name}
                  onChange={(e) => updatePersonaName(e.target.value)}
                  className="w-full px-5 py-3.5 bg-slate-800/60 border-2 border-slate-700/50 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200 shadow-inner"
                  placeholder="페르소나 이름"
                />
              </div>

              <div>
                <label className="flex text-sm font-bold text-slate-300 mb-3 items-center gap-2">
                  <span className="text-cyan-400">📝</span> 설명
                </label>
                <textarea
                  value={selectedPersona.description}
                  onChange={(e) => updatePersonaDescription(e.target.value)}
                  className="w-full px-5 py-3.5 bg-slate-800/60 border-2 border-slate-700/50 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500/50 transition-all duration-200 min-h-[280px] resize-none font-mono text-sm shadow-inner"
                  placeholder="페르소나에 대한 설명을 입력하세요..."
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 숨겨진 파일 입력 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png"
        onChange={handleFileSelect}
        className="hidden"
      />
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        onChange={handleAvatarSelect}
        className="hidden"
      />

      {/* 캐릭터 사이드패널 */}
      {selectedPersona && (
        <CharacterSidePanel
          open={panelOpen}
          onClose={()=>setPanelOpen(false)}
          personaIndex={selectedIndex}
          persona={selectedPersona}
          onChange={applyPersonaFromPanel}
        />
      )}
    </div>
  )
}
