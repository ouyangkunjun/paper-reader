@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\run_reader_public_cloudflared.ps1"
pause
