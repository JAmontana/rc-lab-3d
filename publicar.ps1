<#
.SYNOPSIS
    Publica RC LAB 3D mediante una URL HTTPS temporal de Cloudflare.
.DESCRIPTION
    Mantiene el servidor local de FastAPI en http://127.0.0.1:8000 y abre un
    Cloudflare Quick Tunnel. No requiere cuenta, no modifica el backend, el
    firmware ni el protocolo R1, y conserva WebSocket y Modo Prueba.
.PARAMETER Port
    Puerto local donde ya está corriendo start.ps1. Por defecto, 8000.
.PARAMETER Descargar
    Descarga cloudflared.exe oficial en .\tools\ si no está instalado.
.EXAMPLE
    .\publicar.ps1
.EXAMPLE
    .\publicar.ps1 -Descargar
.NOTES
    La URL es temporal y cambia en cada ejecución. Ctrl+C cierra el túnel;
    el servidor local sigue corriendo en su propia ventana.
#>

param(
    [int]$Port = 8000,
    [switch]$Descargar
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

function Write-Section($text) { Write-Host "`n== $text ==" -ForegroundColor Cyan }
function Write-Ok($text)      { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warn($text)    { Write-Host "[AVISO] $text" -ForegroundColor Yellow }
function Write-Err($text)     { Write-Host "[ERROR] $text" -ForegroundColor Red }

Write-Section "RC LAB 3D - Enlace publico temporal"

# 1. El servidor local debe estar activo antes de abrir el tunel.
$localUrl = "http://127.0.0.1:$Port"
try {
    Invoke-WebRequest -UseBasicParsing -Uri "$localUrl/api/status" -TimeoutSec 5 | Out-Null
} catch {
    Write-Err "No responde $localUrl/api/status."
    Write-Host "Abra otra ventana y ejecute primero:  .\start.ps1" -ForegroundColor Gray
    Write-Host "Cuando la aplicacion local funcione, vuelva a ejecutar .\publicar.ps1" -ForegroundColor Gray
    exit 1
}
Write-Ok "Servidor local disponible en $localUrl"

# 2. Localizar cloudflared sin instalar nada de forma silenciosa.
$exe = $null
$command = Get-Command cloudflared -ErrorAction SilentlyContinue
if ($command) {
    $exe = $command.Source
}
if (-not $exe) {
    $localCandidate = Join-Path $scriptDir "tools\cloudflared.exe"
    if (Test-Path $localCandidate) { $exe = $localCandidate }
}

if (-not $exe -and $Descargar) {
    $toolsDir = Join-Path $scriptDir "tools"
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $target = Join-Path $toolsDir "cloudflared.exe"
    Write-Host "Descargando cloudflared oficial desde GitHub..." -ForegroundColor Gray
    $uri = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $target -TimeoutSec 120
    if (-not (Test-Path $target)) {
        Write-Err "No se pudo descargar cloudflared."
        exit 1
    }
    $exe = $target
    Write-Ok "cloudflared guardado en tools\cloudflared.exe"
}

if (-not $exe) {
    Write-Err "No se encontro cloudflared."
    Write-Host ""
    Write-Host "Opcion A (recomendada): descargarlo con este mismo script:" -ForegroundColor Gray
    Write-Host "  .\publicar.ps1 -Descargar" -ForegroundColor White
    Write-Host ""
    Write-Host "Opcion B: instalarlo con winget y volver a ejecutar:" -ForegroundColor Gray
    Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor White
    Write-Host ""
    Write-Host "Opcion C: descargar manualmente desde" -ForegroundColor Gray
    Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest" -ForegroundColor White
    Write-Host "y colocar cloudflared.exe en la carpeta tools\ del proyecto." -ForegroundColor Gray
    exit 1
}

Write-Ok "cloudflared: $exe"
Write-Host ""
Write-Host "Abriendo tunel HTTPS temporal. Busque la linea 'https://....trycloudflare.com'." -ForegroundColor Cyan
Write-Host "La URL cambia cada vez y deja de funcionar al cerrar este proceso (Ctrl+C)." -ForegroundColor Gray
Write-Host "El servidor local y el Arduino siguen funcionando en su propia ventana." -ForegroundColor Gray
Write-Host ""

& $exe tunnel --url $localUrl --no-autoupdate
