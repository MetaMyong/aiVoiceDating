# AI Voice Dating

Node.js와 React(Vite) 기반의 AI 음성 데이트 애플리케이션입니다.

## 빠른 시작

### 설치
```bash
npm install
```

### 개발 모드 실행
프론트엔드 개발 서버 (Hot Reload):
```bash
npm run dev
```

백엔드 서버:
```bash
npm run server
```

### 프로덕션 빌드 및 실행
```bash
npm start
```

또는 Windows에서:
```bash
.\RUN.bat
```

## 프로젝트 구조

```
.
├── server/              # 백엔드 서버 코드
│   ├── main.js         # 서버 엔트리 포인트
│   ├── index.js        # Express 서버
│   ├── llmModel.js     # LLM 통합
│   ├── ttsProcess.js   # TTS 처리
│   └── sttProcess.js   # STT 처리
├── src/                # 프론트엔드 소스
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   ├── lib/
│   └── pages/
├── dist/               # 빌드 결과물
└── recordings/         # 녹음 파일
```

## 환경 변수

다음 환경 변수를 설정할 수 있습니다:

- `GEMINI_API_KEY`: Google Gemini API 키
- `FISH_AUDIO_API_KEY`: Fish Audio API 키
- `GOOGLE_APPLICATION_CREDENTIALS`: Google Cloud 인증 파일 경로
- `PORT`: 서버 포트 (기본값: 3000)

## 기술 스택

- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Backend**: Node.js, Express
- **AI**: Google Gemini, Fish Audio
- **Speech**: Google Cloud Speech-to-Text, Text-to-Speech
