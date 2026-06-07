# Native iOS Simulator build on macOS (Xcode required).
# Does NOT work on Windows — use ios-simulator-eas.ps1 from Windows instead.
#
# Builds a dev client, installs on the booted simulator, and opens the app.
# Uses repo-root .env.local for EXPO_PUBLIC_DOMAIN (see docs/database.md).

param(
  [string]$Device = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "eas-mobile-common.ps1")

if (-not (Get-Command xcodebuild -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "iOS Simulator local builds require macOS + Xcode." -ForegroundColor Red
  Write-Host ""
  Write-Host "On Windows, use the cloud simulator build instead:" -ForegroundColor Yellow
  Write-Host "  pnpm run ios:sim:eas" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Or use Expo Go against the dev server (limited native modules):" -ForegroundColor Yellow
  Write-Host "  pnpm --filter @workspace/vndrly-mobile run dev:local" -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

Initialize-EasEnvironment

Write-EasStep "Ensuring local API on :8080"
& (Join-Path $script:RepoRoot "scripts\ensure-local-dev.ps1") -RefreshApi
if ($LASTEXITCODE -ne 0) {
  Write-Host "Local API did not start." -ForegroundColor Red
  exit 1
}

Write-EasStep "Building and launching on iOS Simulator (expo run:ios)"
Set-Location $script:RepoRoot

$nodeArgs = @("scripts/run-expo-ios-local.mjs")
if ($Device.Trim()) {
  $nodeArgs += "--device=$($Device.Trim())"
}

node @nodeArgs
exit $LASTEXITCODE
