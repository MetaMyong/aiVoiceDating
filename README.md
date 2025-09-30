요약

이 저장소는 Node.js 기반의 간단한 서버와 React(Vite) 프론트엔드를 함께 담고 있는 데모 프로젝트입니다.

빠른 시작 (PowerShell)

```powershell
cd 'S:\Programming\aiDate_Discord_Bot'
# 루트 의존성 설치
npm install
# 프론트엔드 의존성 설치
cd frontend && npm install
# 프론트엔드 빌드
cd ..
npm run build
# 서버 시작
npm start
```

구성/파일 개요

- `main.js` - 앱 진입점. Express 서버를 시작하고 우아한 종료를 처리합니다.
- `server.js` - API 엔드포인트와 정적 파일 서빙을 담당합니다. Vite 빌드 결과(`frontend/dist`)를 우선 서빙합니다.
- `llmModel.js` - LLM 연동(옵션)과 스트리밍 헬퍼.
- `ttsProcess.js` - TTS 인터페이스.
- `sttProcess.js` - STT 인터페이스.
- `frontend/` - React + Vite 기반의 클라이언트 앱 (설정 UI 등).