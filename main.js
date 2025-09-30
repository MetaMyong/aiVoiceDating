// main.js - 우아한 종료 적용된 엔트리 포인트
const { startServer } = require('./server');

const PORT = process.env.PORT || 3000;

async function main() {
  const server = await startServer(PORT);

  const shutdown = async (signal) => {
    console.log(`받은 신호: ${signal}. 정리 작업 시작...`);
    try {
      server.close(() => console.log('HTTP 서버 종료'));
    } catch (e) {
      console.error('서버 종료 중 오류:', e);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('애플리케이션 시작 실패:', err);
  process.exit(1);
});
