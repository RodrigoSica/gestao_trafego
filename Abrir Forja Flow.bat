@echo off
title Forja Flow - Sistema de Conteudo
cd /d "%~dp0"
start "Forja Flow" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3001"
npm run dev
