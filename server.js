// server.js - Express 기반의 간단한 변환본
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

// No local config file usage. All sensitive keys must be provided by the client per-request.

const app = express();
app.use(express.json());
// 간단한 CORS 허용 (개발용)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return res.sendStatus(204);
  }
  next();
});

// Removed /api/config and /api/fish-models endpoints to avoid reliance on local config.json

// 호환성: 프론트엔드에서 기대하는 /api/fishaudio/models 엔드포인트
app.get('/api/fishaudio/models', async (req, res) => {
  try {
    // apiKey must be provided per-request either as ?apiKey=... or Authorization: Bearer ...
    const apiKeyQuery = req.query.apiKey;
    const authHeader = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
    const apiKey = apiKeyQuery || authHeader;
    if (!apiKey) return res.status(400).json({ error: 'Fish Audio API 키가 제공되지 않았습니다. 쿼리(apiKey) 또는 Authorization 헤더를 사용하세요.' });
    const url = 'https://api.fish.audio/model?self=true&sort_by=created_at';
    const r = await axios.get(url, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000 });
    const data = r.data || {};
    const myModels = (data.items || []).filter(m => m.state === 'trained').map(m => ({ name: m.title, id: m._id, modelId: m.modelId || null }));
    return res.json({ models: myModels });
  } catch (e) {
    console.error('fishaudio models error', e.response ? e.response.data : e.message);
    const upstream = e.response ? e.response.data : undefined;
    return res.status(500).json({ error: 'FishAudio 모델 목록 조회 실패', upstream });
  }
});

// 정적 파일 서빙: 우선순위: frontend/dist (Vite build) -> public
const frontendDist = path.join(__dirname, 'frontend', 'dist');
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(frontendDist)) {
  console.log('[server] serving frontend dist at', frontendDist);
  app.use('/', express.static(frontendDist));
} else if (fs.existsSync(publicDir)) {
  console.log('[server] serving public at', publicDir);
  app.use('/', express.static(publicDir));
} else {
  console.log('[server] no static directory found (frontend/dist or public)');
}

// SPA fallback: for any GET that isn't an API call, return index.html so the client-side router can handle routes like /settings
app.get('*', (req, res, next) => {
  // let API routes continue to their handlers
  if (req.path.startsWith('/api/')) return next();
  const indexFromDist = path.join(frontendDist, 'index.html');
  const indexFromPublic = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexFromDist)) return res.sendFile(indexFromDist);
  if (fs.existsSync(indexFromPublic)) return res.sendFile(indexFromPublic);
  // nothing to serve
  res.status(404).send('Not found');
});

function startServer(port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`HTTP 서버 실행 중: http://127.0.0.1:${port}`);
      // open default browser to the server URL (best-effort)
      try {
        const url = `http://127.0.0.1:${port}`;
        const { exec } = require('child_process');
        // only auto-open when explicitly allowed
        if (process.env.OPEN_BROWSER === 'true') {
          if (process.platform === 'win32') {
            exec(`start "" "${url}"`);
          } else if (process.platform === 'darwin') {
            exec(`open "${url}"`);
          } else {
            exec(`xdg-open "${url}"`);
          }
        } else {
          console.log('[server] auto-open disabled (set OPEN_BROWSER=true to enable)');
        }
      } catch (e) {}
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
