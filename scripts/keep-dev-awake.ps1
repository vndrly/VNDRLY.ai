# Keeps Windows from sleeping while this window is open, and restarts local
# dev (API :8080 + web :5173) if either port goes down.
#
# Run once after boot / crash / sleep:
#   pnpm wake          — start servers + open browser
#   pnpm dev:watch     — same + keep PC awake + auto-restart if servers die
#
# Close this window to allow normal sleep again.

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VndrlyPower {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED — block system sleep while script runs.
$ES_CONTINUOUS = 0x80000000
$ES_SYSTEM_REQUIRED = 0x00000001
$KEEP_AWAKE_FLAGS = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ensureScript = Join-Path $Repo "scripts/ensure-local-dev.ps1"

function Test-PortListening {
  param([int]$Port)
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $conn
}

function Test-DevHealthy {
  if (-not (Test-PortListening -Port 8080)) { return $false }
  if (-not (Test-PortListening -Port 5173)) { return $false }
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 3
    return $resp.StatusCode -eq 200
  } catch {
    return $false
  }
}

Write-Host ""
Write-Host "VNDRLY dev watch — PC will not sleep while this window stays open."
Write-Host "Servers: http://localhost:5173/  (API http://localhost:8080/)"
Write-Host "Close this window to allow sleep again."
Write-Host ""

# First boot: ensure servers are up (no browser — use pnpm wake for that).
& $ensureScript

$checkSeconds = 45
while ($true) {
  [void][VndrlyPower]::SetThreadExecutionState($KEEP_AWAKE_FLAGS)

  if (-not (Test-DevHealthy)) {
    $stamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$stamp] Dev servers offline — restarting..."
    & $ensureScript
  }

  Start-Sleep -Seconds $checkSeconds
}
