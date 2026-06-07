# Build an iOS Simulator .app via EAS (works from Windows or Mac).
# Uses eas.json profile "development" (simulator: true, dev client).
#
# After the build finishes, open the EAS build URL on a Mac, download the
# artifact, then install:
#   tar -xzf *.tar.gz
#   xcrun simctl install booted ./VNDRLY*.app
#   xcrun simctl launch booted com.vndrly.field
#
# Or run:  pnpm run ios:sim:install  (Mac only, after download)

param(
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "eas-mobile-common.ps1")

Initialize-EasEnvironment
Assert-EasCli

Write-EasStep "Checking Expo login (must be vndrlyadmin — project owner)"
Invoke-Eas @("whoami", "--non-interactive")

Write-EasStep "Ensuring local API for optional dev testing"
& (Join-Path $script:RepoRoot "scripts\ensure-local-dev.ps1") -RefreshApi | Out-Null

Write-EasStep "Starting EAS iOS Simulator build (profile: development)"
$buildArgs = @("build", "--platform", "ios", "--profile", "development")
if ($NonInteractive) {
  $buildArgs += "--non-interactive"
}
Invoke-Eas $buildArgs

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  iOS Simulator build queued" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  1. Open the build URL from EAS output above."
Write-Host "  2. On a Mac, download the .tar.gz artifact."
Write-Host "  3. Run:  pnpm run ios:sim:install -- <path-to.tar.gz>"
Write-Host ""
Write-Host "  Expo account for billing: vndrlyadmin (VNDRLYAdmin)" -ForegroundColor Cyan
Write-Host "  Apple submit email (TestFlight): v@vndrly.ai (separate — not Expo billing)" -ForegroundColor DarkGray
Write-Host ""
