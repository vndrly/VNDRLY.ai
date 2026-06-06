# Shared EAS helpers for VNDRLY mobile scripts (run from any cwd).

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$script:MobileRoot = Join-Path $script:RepoRoot "artifacts\vndrly-mobile"
$script:EasCli = Join-Path $script:MobileRoot "node_modules\.bin\eas.cmd"

function Initialize-EasEnvironment {
  $env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
  if (-not $env:NODE_OPTIONS) {
    $env:NODE_OPTIONS = "--use-system-ca"
  } elseif ($env:NODE_OPTIONS -notmatch "--use-system-ca") {
    $env:NODE_OPTIONS = "$env:NODE_OPTIONS --use-system-ca"
  }
}

function Assert-EasCli {
  if (-not (Test-Path $script:EasCli)) {
    Write-Host ""
    Write-Host "EAS CLI not found at:" -ForegroundColor Red
    Write-Host "  $script:EasCli" -ForegroundColor Red
    Write-Host ""
    Write-Host "From repo root run:  pnpm install" -ForegroundColor Yellow
    exit 1
  }
}

function Invoke-Eas {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  Set-Location $script:MobileRoot
  & $script:EasCli @Args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

function Write-EasStep {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}
