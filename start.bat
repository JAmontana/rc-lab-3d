@echo off
REM RC LAB 3D - lanzador para Windows.
REM Delega en start.ps1 sin cambiar la politica de ejecucion global.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
