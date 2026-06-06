# Shared helpers for Ship it / publish scripts.

function Write-ShipStep {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-ShipSuccess {
  param([hashtable]$Summary)
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "  SHIP IT — SUCCESS" -ForegroundColor Green
  Write-Host "========================================" -ForegroundColor Green
  foreach ($key in @("Commit", "Live", "iOS build", "TestFlight", "Local web", "Local API")) {
    if ($Summary.ContainsKey($key) -and $Summary[$key]) {
      Write-Host ("  {0,-12} {1}" -f ($key + ":"), $Summary[$key])
    }
  }
  Write-Host "========================================" -ForegroundColor Green
  Write-Host ""
}

function Write-ShipFailure {
  param(
    [string]$Step,
    [string]$Reason
  )
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Red
  Write-Host "  SHIP IT — FAILED" -ForegroundColor Red
  Write-Host "========================================" -ForegroundColor Red
  Write-Host ("  Step:   {0}" -f $Step) -ForegroundColor Red
  Write-Host ("  Reason: {0}" -f $Reason) -ForegroundColor Red
  Write-Host "========================================" -ForegroundColor Red
  Write-Host ""
}

function Remove-StaleGitLock {
  param([string]$Root)
  $lock = Join-Path $Root ".git/index.lock"
  if (-not (Test-Path $lock)) { return }
  $age = (Get-Date) - (Get-Item $lock).LastWriteTime
  if ($age.TotalMinutes -gt 2) {
    Write-Host "Removing stale .git/index.lock ..."
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
  }
}

function Add-GitShipChanges {
  param([string]$Root)
  Set-Location $Root
  Remove-StaleGitLock -Root $Root

  & git add -u
  if ($LASTEXITCODE -ne 0) { throw "git add -u failed (exit $LASTEXITCODE)" }

  $pathspecs = @(
    "artifacts", "lib", "scripts", "docs", "attached_assets",
    "package.json", "pnpm-lock.yaml", ".npmrc", ".gitignore",
    "tsconfig.base.json", "Start-VNDRLY-Dev.ps1", ".vscode/settings.json"
  )

  foreach ($path in $pathspecs) {
    $full = Join-Path $Root $path
    if (-not (Test-Path $full)) { continue }
    & git add -- $path
    if ($LASTEXITCODE -ne 0) {
      throw "git add -- $path failed (exit $LASTEXITCODE)"
    }
  }
}

function Test-LocalDevHealthy {
  try {
    $web = Invoke-WebRequest -Uri "http://localhost:5173/" -UseBasicParsing -TimeoutSec 5
    if ($web.StatusCode -ne 200) { return $false }
  } catch {
    return $false
  }
  try {
    $api = Invoke-WebRequest -Uri "http://localhost:8080/api/health" -UseBasicParsing -TimeoutSec 5
    return ($api.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Invoke-NativeQuiet {
  param(
    [string]$Exe,
    [string[]]$Args
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Exe @Args 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        Write-Host $_.ToString()
      } else {
        Write-Host $_
      }
    }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
}
