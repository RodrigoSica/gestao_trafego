@echo off
title Studio OS - Rodrigo Sicheroli
cd /d "%~dp0"
start "Studio OS" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3001"
npm run dev
