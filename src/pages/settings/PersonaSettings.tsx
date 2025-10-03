import React, { useState, useRef, useEffect } from 'react'
import { pushToast } from '../../components/Toast'

interface Persona {
  name: string
  description: string
  avatar: string // base64 or URL
  characterData?: any // 전체 character card 데이터
}

export default function PersonaSettings(props: any) {
  const { cfg, setCfg } = props
  const [personas, setPersonas] = useState<Persona[]>(cfg?.personas || [])
  const [selectedIndex, setSelectedIndex] = useState<number>(cfg?.selectedPersonaIndex ?? 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)

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

        // tEXt 청크에서 캐릭터 데이터 찾기 (chara, persona 등)
        if (type === 'tEXt') {
          let keyEnd = pos
          while (keyEnd < pos + length && uint8[keyEnd] !== 0) {
            keyEnd++
          }
          const key = String.fromCharCode(...Array.from(uint8.slice(pos, keyEnd)))
          
          // 'chara' 또는 'persona' 키 지원
          if (key === 'chara' || key === 'persona') {
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
        const newPersona: Persona = {
          name: characterData.name || characterData.char_name || '이름 없음',
          description: characterData.description || characterData.personaPrompt || characterData.personality || '',
          avatar: base64,
          characterData: characterData
        }

        const updated = [...personas, newPersona]
        setPersonas(updated)
        setSelectedIndex(updated.length - 1)
        
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

      // tEXt 청크 생성 (persona 키 사용)
      const keyword = 'persona'
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

  return (
    <div className="flex flex-col gap-4">
      {/* 상단: 페르소나 갤러리 */}
      <section className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">
            페르소나 갤러리
            {selectedPersona && <span className="ml-3 text-sm font-normal text-orange-600">현재: {selectedPersona.name}</span>}
          </h3>
          <div className="flex gap-2">
            <button
              onClick={handleImportCard}
              className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
            >
              임포트
            </button>
            <button
              onClick={handleExportCard}
              disabled={!selectedPersona}
              className="px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              익스포트
            </button>
          </div>
        </div>

        {/* 페르소나 썸네일 그리드 */}
        <div className="grid grid-cols-6 gap-3">
          {personas.map((persona, idx) => (
            <div
              key={idx}
              onClick={() => {
                setSelectedIndex(idx)
              }}
              className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                idx === selectedIndex
                  ? 'border-orange-500 shadow-lg scale-105'
                  : 'border-gray-200 hover:border-gray-400'
              }`}
            >
              <div className="aspect-square bg-gray-100 flex items-center justify-center">
                {persona.avatar ? (
                  <img
                    src={persona.avatar}
                    alt={persona.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-gray-400 text-4xl">?</div>
                )}
              </div>
            </div>
          ))}
          
          {/* 추가 버튼 */}
          <div
            onClick={handleCreatePersona}
            className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-orange-400 cursor-pointer flex items-center justify-center bg-gray-50 hover:bg-orange-50 transition-colors"
          >
            <span className="text-3xl text-gray-400">+</span>
          </div>
        </div>
      </section>

      {/* 하단: 선택된 페르소나 상세 정보 */}
      {selectedPersona && (
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex gap-6">
            {/* 좌측: 아바타 */}
            <div className="flex-shrink-0">
              <div
                onClick={handleChangeAvatar}
                className="w-48 h-48 rounded-lg overflow-hidden border-2 border-gray-300 hover:border-orange-400 cursor-pointer transition-all bg-gray-100 flex items-center justify-center"
                title="클릭하여 이미지 변경"
              >
                {selectedPersona.avatar ? (
                  <img
                    src={selectedPersona.avatar}
                    alt={selectedPersona.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-gray-400 text-6xl">?</div>
                )}
              </div>
              <button
                onClick={handleDeletePersona}
                className="mt-3 w-full px-3 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
              >
                삭제
              </button>
            </div>

            {/* 우측: 정보 */}
            <div className="flex-1 flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input
                  type="text"
                  value={selectedPersona.name}
                  onChange={(e) => updatePersonaName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="페르소나 이름"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">설명</label>
                <textarea
                  value={selectedPersona.description}
                  onChange={(e) => updatePersonaDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-400 min-h-[200px] resize-none font-mono text-sm"
                  placeholder="페르소나에 대한 설명을 입력하세요..."
                />
              </div>

              {selectedPersona.characterData && (
                <div className="mt-2">
                  <details className="text-xs text-gray-500">
                    <summary className="cursor-pointer hover:text-gray-700">캐릭터 카드 원본 데이터</summary>
                    <pre className="mt-2 p-2 bg-gray-50 rounded overflow-auto max-h-40 text-xs">
                      {JSON.stringify(selectedPersona.characterData, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
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
    </div>
  )
}
