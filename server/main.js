// server/main.js - 서버 엔트리 포인트
const { startServer } = require('./index');

const PORT = process.env.PORT || 3000;

// Graceful shutdown flag
let isShuttingDown = false;

async function main() {
  const server = await startServer(PORT);

  const shutdown = async (signal) => {
    if (isShuttingDown) {
      console.log('이미 종료 중입니다...');
      return;
    }
    
    isShuttingDown = true;
    console.log(`\n받은 신호: ${signal}. 정리 작업 시작...`);
    
    try {
      // Close server gracefully with timeout
      const closePromise = new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve('timeout'), 5000)
      );

      const result = await Promise.race([closePromise, timeoutPromise]);
      
      if (result === 'timeout') {
        console.log('⚠️ 서버 종료 시간 초과. 강제 종료합니다.');
      } else {
        console.log('✓ HTTP 서버 정상 종료');
      }
    } catch (e) {
      console.error('❌ 서버 종료 중 오류:', e.message);
    }
    
    console.log('종료 완료.');
    process.exit(0);
  };

  // Handle Ctrl+C on Windows
  if (process.platform === 'win32') {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.on('SIGINT', () => {
      shutdown('SIGINT');
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('❌ 예외 발생:', err);
    shutdown('uncaughtException');
  });
}

main().catch(err => {
  console.error('❌ 애플리케이션 시작 실패:', err);
  process.exit(1);
});
