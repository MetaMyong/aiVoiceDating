@echo off
echo ==========================================
echo AI Voice Dating - 프로젝트 구조 통합
echo ==========================================
echo.

REM 1. 기존 루트 파일 백업
echo [1/5] 기존 루트 파일 백업 중...
if not exist "backup_old_root" mkdir "backup_old_root"
move /Y main.js backup_old_root\ 2>nul
move /Y llmModel.js backup_old_root\ 2>nul
move /Y server.js backup_old_root\ 2>nul
move /Y start-server-only.js backup_old_root\ 2>nul
move /Y ttsProcess.js backup_old_root\ 2>nul
move /Y sttProcess.js backup_old_root\ 2>nul
move /Y package.json backup_old_root\ 2>nul
move /Y pnpm-lock.yaml backup_old_root\ 2>nul
echo 백업 완료: backup_old_root 폴더

echo.
echo [2/5] frontend의 새 파일들을 적용 중...
REM package.json 교체
move /Y frontend\package-new.json frontend\package.json
REM README 교체
move /Y frontend\README-new.md frontend\README.md

echo.
echo [3/5] frontend 내용을 루트로 이동 중...
REM frontend의 모든 파일과 폴더를 루트로 복사
xcopy /E /I /Y frontend\* . >nul

echo.
echo [4/5] 기존 frontend 폴더 정리...
REM 기존 frontend 폴더를 백업으로 이동
move /Y frontend backup_old_frontend 2>nul

echo.
echo [5/5] recordings 폴더 확인...
if not exist "recordings" mkdir "recordings"

echo.
echo ==========================================
echo 통합 완료!
echo ==========================================
echo.
echo 다음 명령어로 실행하세요:
echo   npm install
echo   npm start
echo.
echo 또는:
echo   .\RUN.bat
echo.
pause
