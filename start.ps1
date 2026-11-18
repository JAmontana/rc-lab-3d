<#
.SYNOPSIS
    Arranca RC LAB 3D en Windows (PowerShell) con un entorno virtual local.
.DESCRIPTION
    Crea .venv si no existe, instala/verifica requirements.txt, comprueba que
    el puerto 8000 esté libre y arranca FastAPI/uvicorn en primer plano.
    Ctrl+C detiene el servidor y libera el puerto serial.
.NOTES
    No modifica la directiva de ejecución global de PowerShell.
    Si el script está bloqueado: powershell -ExecutionPolicy Bypass -File .\start.ps1
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$Host.UI.RawUI.WindowTitle = "RC LAB 3D - Servidor local"
$port = 8000

function Write-Section($text) { Write-Host "`n== $text ==" -ForegroundColor Cyan }
function Write-Ok($text)      { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warn($text)    { Write-Host "[AVISO] $text" -ForegroundColor Yellow }
function Write-Err($text)     { Write-Host "[ERROR] $text" -ForegroundColor Red }

Write-Section "RC LAB 3D - Inicio de la aplicacion"

# 1. Python base
$basePython = Get-Command python -ErrorAction SilentlyContinue
if (-not $basePython) {
    Write-Err "Python no esta instalado o no esta en el PATH. Instale Python 3.12+ y reintente."
    exit 1
}
Write-Ok "Python base: $(& python --version 2>&1)"

# 2. Entorno virtual local
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Creando entorno virtual .venv ..." -ForegroundColor Cyan
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
        Write-Err "No se pudo crear .venv. Verifique la instalacion de Python (modulo venv)."
        exit 1
    }
    Write-Ok "Entorno virtual creado."
}

# 3. Dependencias: solo se instalan si falta alguna
Write-Host "Verificando dependencias..." -ForegroundColor Cyan
& $venvPython -c "import fastapi, uvicorn, serial, numpy, scipy, pydantic" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Dependencias disponibles en .venv (sin reinstalar)."
} else {
    Write-Host "Instalando dependencias de requirements.txt ..." -ForegroundColor Cyan
    & $venvPython -m pip install --disable-pip-version-check -q -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Err "No se pudieron instalar las dependencias. Revise su conexion o ejecute:"
        Write-Host "  $venvPython -m pip install -r requirements.txt" -ForegroundColor Gray
        exit 1
    }
    & $venvPython -c "import fastapi, uvicorn, serial, numpy, scipy, pydantic" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Las dependencias no se importan correctamente dentro de .venv."
        exit 1
    }
    Write-Ok "Dependencias instaladas en .venv."
}

# 4. Puerto libre
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $owner = ($listener | Select-Object -First 1).OwningProcess
    Write-Err "El puerto $port ya esta ocupado (PID $owner)."
    Write-Host "Detenga el proceso con: Stop-Process -Id $owner" -ForegroundColor Gray
    exit 1
}

# 5. Arranque en primer plano (Ctrl+C cierra uvicorn y libera el puerto)
Write-Host ""
Write-Host "--------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  APLICACION:  http://127.0.0.1:$port" -ForegroundColor Green
Write-Host "  API docs:    http://127.0.0.1:$port/docs" -ForegroundColor Gray
Write-Host "  Estado API:  http://127.0.0.1:$port/api/status" -ForegroundColor Gray
Write-Host "  WebSocket:   ws://127.0.0.1:$port/ws/live" -ForegroundColor Gray
Write-Host "--------------------------------------------------------------" -ForegroundColor Cyan
Write-Host "  1. Abra la aplicacion en el navegador." -ForegroundColor Gray
Write-Host "  2. Conecte el Arduino Uno por USB (firmware R1, 9600 baudios)." -ForegroundColor Gray
Write-Host "     Seleccione el puerto COM y pulse 'Conectar Arduino'." -ForegroundColor Gray
Write-Host "  3. Sin hardware, use 'Modo prueba' (datos SIMULACION)." -ForegroundColor Gray
Write-Host ""
Write-Host "Ctrl+C detiene el servidor y libera el puerto serial." -ForegroundColor Yellow
Write-Host ""

try {
    & $venvPython -m uvicorn backend.app:app --host 127.0.0.1 --port $port
}
finally {
    Write-Host "`nServidor detenido. Puerto serial liberado." -ForegroundColor Yellow
}
