@echo off
setlocal

echo Installing dependencies...
call npm install

echo.
echo Building frontend...
call npm run build

echo.
echo Starting server...
rem Ctrl+C will gracefully shutdown without prompting
call npm run server

endlocal
