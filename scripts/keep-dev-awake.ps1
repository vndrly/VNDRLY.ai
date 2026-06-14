# Keeps Windows from sleeping while this window is open, and restarts local
# dev (API :8080 + web :5173) if either port goes down or stops responding.
#
# Run once after boot (or install autostart — see install-local-dev-autostart.ps1):
#   pnpm dev:watch     — keep PC awake + auto-restart if servers die
#   pnpm wake          — one-shot start + browser (no watch)
#
# Close this window to allow normal sleep again (unless autostart is installed).

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
# Use decimal [uint32] literals: hex 0x80000000 overflows signed int32 in PS 5.1
# before the cast and throws "too large or too small for UInt32".
$ES_CONTINUOUS = [uint32]2147483648
$ES_SYSTEM_REQUIRED = [uint32]1
$KEEP_AWAKE_FLAGS = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED

function Set-KeepAwake {
  try {
    [void][VndrlyPower]::SetThreadExecutionState($KEEP_AWAKE_FLAGS)
  } catch {
    # Non-fatal — auto-restart of :5173/:8080 matters more than anti-sleep.
  }
}

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
    $api = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 5
    if ($api.StatusCode -ne 200) { return $false }
  } catch {
    return $false
  }
  try {
    $web = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 5
    if ($web.StatusCode -lt 200 -or $web.StatusCode -ge 400) { return $false }
  } catch {
    return $false
  }
  return $true
}

$checkSeconds = 30

Write-Host ""
Write-Host "VNDRLY dev watch - PC will not sleep while this window stays open."
Write-Host "Servers: http://localhost:5173/  (API http://localhost:8080/)"
Write-Host "Auto-restarts hung/offline servers every ${checkSeconds}s. Close window to allow sleep."
Write-Host ""

& $ensureScript
while ($true) {
  Set-KeepAwake

  if (-not (Test-DevHealthy)) {
    $stamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$stamp] Dev servers offline or hung - recovering..."
    & $ensureScript -Recover
  }

  Start-Sleep -Seconds $checkSeconds
}
