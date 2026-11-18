@echo off
REM RC LAB 3D - Abre una URL HTTPS temporal con Cloudflare Quick Tunnel.
REM El servidor local debe estar corriendo con start.bat en otra ventana.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1" %*
pause
