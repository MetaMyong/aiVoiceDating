@echo off
echo Installing dependencies...
call npm install

echo.
echo Building frontend...
call npm run build

echo.
echo Starting server...
call npm run server
