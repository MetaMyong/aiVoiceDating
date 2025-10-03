// server/index.js - Express 기반의 통합 서버
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');

const app = express();
app.use(express.json());

// CORS 허용 (개발용)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return res.sendStatus(204);
  }
  next();
});

// Fish Audio 모델 목록 조회 엔드포인트
app.get('/api/fishaudio/models', async (req, res) => {
  try {
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

// 정적 파일 서빙: dist 폴더
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  console.log('[server] serving dist at', distDir);
  app.use('/', express.static(distDir));
}

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Not found');
});

function startServer(port) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`HTTP 서버 실행 중: http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

module.exports = { app, startServer };
