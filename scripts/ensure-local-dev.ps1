# Start (or refresh) local web + API dev servers for http://localhost:5173/
# Used by pnpm save, Start-VNDRLY-Dev.ps1, and TestFlight build scripts.

param(
  [switch]$OpenBrowser,
  [switch]$RefreshApi
)

$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:VNDRLY_LOAD_ENV_LOCAL = "1"

function Test-PortListening {
  param([int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $conn
}

function Stop-PortListener {
  param([int]$Port)
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

function Start-DevWindow {
  param(
    [string]$Title,
    [string]$Command
  )
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
  )
}

$apiScript = Join-Path $Repo "scripts/run-api-local.mjs"
$viteScript = Join-Path $Repo "scripts/run-vite-local.mjs"

if (-not (Test-Path "$Repo/artifacts/api-server/dist/index.mjs")) {
  Write-Host "Building API (first run)..."
  Set-Location $Repo
  npm exec --yes pnpm@9.15.9 -- --filter @workspace/api-server run build
}

$apiUp = Test-PortListening -Port 8080
$viteUp = Test-PortListening -Port 5173
$viteStarted = $false

if ($RefreshApi -and $apiUp) {
  Write-Host "Restarting local API on :8080..."
  Stop-PortListener -Port 8080
  Start-Sleep -Seconds 2
  $apiUp = $false
}

if (-not $apiUp) {
  Write-Host "Starting local API on :8080..."
  $apiCmd = @(
    "`$env:Path='C:\Program Files\nodejs;' + `$env:APPDATA + '\npm;' + `$env:Path'",
    "`$env:NODE_OPTIONS='--use-system-ca'",
    "`$env:VNDRLY_LOAD_ENV_LOCAL='1'",
    "Set-Location '$Repo'",
    "node '$apiScript'"
  ) -join "; "
  Start-DevWindow -Title "VNDRLY API (8080)" -Command $apiCmd
  Start-Sleep -Seconds 4
} else {
  Write-Host "Local API already running on :8080"
}

if (-not $viteUp) {
  Write-Host "Starting local web on :5173..."
  $viteCmd = @(
    "`$env:Path='C:\Program Files\nodejs;' + `$env:APPDATA + '\npm;' + `$env:Path'",
    "`$env:NODE_OPTIONS='--use-system-ca'",
    "`$env:VNDRLY_LOAD_ENV_LOCAL='1'",
    "Set-Location '$Repo'",
    "node '$viteScript'"
  ) -join "; "
  Start-DevWindow -Title "VNDRLY Web (5173)" -Command $viteCmd
  Start-Sleep -Seconds 6
  $viteStarted = $true
} else {
  Write-Host "Local web already running on :5173"
}

Write-Host ""
Write-Host "Local dev ready: http://localhost:5173/ (API http://localhost:8080/)"

if ($OpenBrowser -or $viteStarted) {
  Start-Process "http://localhost:5173/"
}
