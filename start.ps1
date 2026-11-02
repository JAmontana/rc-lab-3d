<#
.SYNOPSIS
    Arranca RC LAB 3D en Windows (PowerShell).
.DESCRIPTION
    Comprueba Python y las dependencias, inicia el servidor FastAPI/uvicorn
    y muestra la URL local de la aplicación. Puede ejecutarse antes de conectar
    el Arduino; incluye un modo de prueba sintética para validar la interfaz
    sin hardware físico.
.NOTES
    No modifica la directiva de ejecución de PowerShell global.
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Colores de consola
function Write-Section($text) { Write-Host "`n== $text ==" -ForegroundColor Cyan }
function Write-Ok($text)  { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warn($text){ Write-Host "[AVISO] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "[ERROR] $text" -ForegroundColor Red }

Write-Section "RC LAB 3D — Inicio de la aplicación"

# 1. Comprobar Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Err "Python no está instalado o no está en el PATH. Instale Python 3.9+ y vuelva a ejecutar."
    exit 1
}
$pyVersion = python --version 2>&1
Write-Ok "Python detectado: $pyVersion"

# 2. Verificar dependencias críticas
$requiredModules = @("fastapi", "uvicorn", "serial", "websockets")
$missing = @()
foreach ($mod in $requiredModules) {
    $found = python -c "import $mod" 2>$null
    if ($LASTEXITCODE -ne 0) { $missing += $mod }
}

if ($missing.Count -gt 0) {
    Write-Warn "Faltan dependencias: $($missing -join ', ')"
    Write-Host "Instalando dependencias faltantes..." -ForegroundColor Cyan
    python -m pip install $missing
    if ($LASTEXITCODE -ne 0) {
        Write-Err "No se pudieron instalar las dependencias. Revise su conexión a internet o instale manualmente: $($missing -join ' ')"
        exit 1
    }
    Write-Ok "Dependencias instaladas."
} else {
    Write-Ok "Todas las dependencias críticas están disponibles."
}

# 3. Evitar procesos duplicados de uvicorn en el puerto 8000
$existing = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*uvicorn backend.app:app*" }
if ($existing) {
    Write-Warn "Ya existe una instancia de uvicorn ejecutándose (PID $($existing.Id)). Abortando para evitar duplicados."
    Write-Host "Para detenerla manualmente: Stop-Process -Name python"
    exit 0
}

# 4. Arrancar el backend
Write-Host "Arrancando servidor FastAPI en http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$backendProcess = Start-Process python -ArgumentList '-m uvicorn backend.app:app --host 127.0.0.1 --port 8000' -PassThru -WorkingDirectory $scriptDir

Write-Ok "Servidor iniciado (PID $($backendProcess.Id))."
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  APLICACIÓN DISPONIBLE EN: http://127.0.0.1:8000" -ForegroundColor Green -NoNewline
Write-Host ""
Write-Host "  Endpoints útiles:" -ForegroundColor Cyan
Write-Host "    - API estado:        http://127.0.0.1:8000/api/status" -ForegroundColor Gray
Write-Host "    - Puertos COM:       http://127.0.0.1:8000/api/ports" -ForegroundColor Gray
Write-Host "    - Simulación RC:     http://127.0.0.1:8000/api/math/simulate (POST)" -ForegroundColor Gray
Write-Host "  WebSocket telemetría:  ws://127.0.0.1:8000/ws/live" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Pasos siguientes:" -ForegroundColor Cyan
Write-Host "  1. Abra http://127.0.0.1:8000 en su navegador."
Write-Host "  2. Conecte su Arduino Uno por USB y seleccione el puerto COM en la barra superior."
Write-Host "  3. Haga clic en 'Conectar USB' (115200 baudios)."
Write-Host "  4. O use el botón 'Modo Test' para validar la interfaz con datos sintéticos."
Write-Host ""
Write-Host "Para detener el servidor presione Ctrl+C en esta ventana o ejecute:" -ForegroundColor Cyan
Write-Host "    Stop-Process -Name python" -ForegroundColor Gray

# Mantener el proceso en primer plano mientras el usuario no presione Ctrl+C
Write-Host "`nPresione Ctrl+C para detener el servidor y liberar el puerto." -ForegroundColor Gray
try {
    while ($true) { Start-Sleep -Seconds 1 }
} catch {
    Write-Host "`nDeteniendo servidor..." -ForegroundColor Yellow
    Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
    Write-Ok "Servidor detenido. Puerto serial liberado."
}
