# Start (or refresh) local web + API dev servers for http://localhost:5173/
# Used by pnpm save, Start-VNDRLY-Dev.ps1, and TestFlight build scripts.

param(
  [switch]$OpenBrowser,
  [switch]$RefreshApi,
  [switch]$Recover,
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeDir = "C:\Users\JohnElerick\DEV\tools\node"
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$env:VNDRLY_LOAD_ENV_LOCAL = "1"

function Test-PortListening {
  param([int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $conn
}

function Wait-ForPort {
  param(
    [int]$Port,
    [string]$Label,
    [int]$TimeoutSeconds = 120
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -Port $Port) {
      return $true
    }
    Write-Host "  Waiting for $Label on :$Port..."
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-PortListener {
  param([int]$Port)
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
      Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForApiHealth {
  param([int]$TimeoutSeconds = 180)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-PortListening -Port 8080) {
      try {
        $resp = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -eq 200) { return $true }
      } catch {
        # port up but not ready yet
      }
    }
    Write-Host "  Waiting for API on :8080..."
    Start-Sleep -Seconds 3
  }
  return $false
}

$apiScript = Join-Path $Repo "scripts/start-api-dev.ps1"
$viteScript = Join-Path $Repo "scripts/start-vite-dev.ps1"

if ($Recover) {
  Write-Host "Recovering local dev - stopping listeners on :8080 and :5173..."
  Stop-PortListener -Port 8080
  Stop-PortListener -Port 5173
  Start-Sleep -Seconds 2
}

if (-not (Test-Path "$Repo/artifacts/api-server/dist/index.mjs")) {
  Write-Host "Building API (first run)..."
  Set-Location $Repo
  npm exec --yes pnpm@9.15.9 -- --filter @workspace/api-server run build
}

$apiUp = if ($Recover) { $false } else { Test-PortListening -Port 8080 }
$viteUp = if ($Recover) { $false } else { Test-PortListening -Port 5173 }
$viteStarted = $false

if ($RefreshApi -and $apiUp) {
  Write-Host "Restarting local API on :8080..."
  Stop-PortListener -Port 8080
  Start-Sleep -Seconds 2
  $apiUp = $false
}

if (-not $apiUp) {
  Write-Host "Starting local API on :8080..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'VNDRLY API (8080)'; & '$apiScript'"
  )
  if (-not (Wait-ForApiHealth -TimeoutSeconds 180)) {
    Write-Host "API did not become healthy on :8080 within 3 minutes." -ForegroundColor $(if ($Strict) { "Red" } else { "Yellow" })
    if ($Strict) { exit 1 }
  }
} else {
  Write-Host "Local API already running on :8080"
}

if (-not $viteUp) {
  Write-Host "Starting local web on :5173..."
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-Command",
    "`$Host.UI.RawUI.WindowTitle = 'VNDRLY Web (5173)'; & '$viteScript'"
  )
  if (-not (Wait-ForPort -Port 5173 -Label "web" -TimeoutSeconds 60)) {
    Write-Host "Web did not start on :5173 within 1 minute." -ForegroundColor $(if ($Strict) { "Red" } else { "Yellow" })
    if ($Strict) { exit 1 }
  }
  $viteStarted = $true
} else {
  Write-Host "Local web already running on :5173"
}

Write-Host ""
Write-Host "Local dev ready: http://localhost:5173/ (API http://localhost:8080/)"

if ($OpenBrowser -or $viteStarted) {
  Start-Process 'http://localhost:5173/'
}
