@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Jarvis necesita Node.js para servir esta pagina localmente.
  echo Puedes descargarlo desde https://nodejs.org/
  pause
  exit /b 1
)
node serve.mjs
