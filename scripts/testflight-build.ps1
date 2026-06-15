# Build iOS on EAS (optional -Submit). Safe to run from repo root.
param(
  [switch]$Submit,
  [switch]$NonInteractive,
  [switch]$SkipTypecheck,
  [switch]$SkipEnsureDev
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "eas-mobile-common.ps1")

Initialize-EasEnvironment
Assert-EasCli

$ascKeyPath = Join-Path $script:RepoRoot ".local\AuthKey_C7YFYCR72K.p8"
if (Test-Path $ascKeyPath) {
  $env:EXPO_ASC_API_KEY_PATH = $ascKeyPath
  $env:EXPO_ASC_KEY_ID = "C7YFYCR72K"
  $env:EXPO_ASC_ISSUER_ID = "0bb5c187-d2b0-4058-91b2-b1cccccaac53"
  $env:EXPO_APPLE_TEAM_ID = "CM253WWQW2"
  $env:EXPO_APPLE_TEAM_TYPE = "INDIVIDUAL"
}

Write-EasStep "Checking Expo login"
Invoke-Eas @("whoami", "--non-interactive")

if (-not $SkipTypecheck) {
  Write-EasStep "Running mobile TypeScript check"
  Set-Location $script:RepoRoot
  pnpm --filter @workspace/vndrly-mobile run typecheck -- --pretty false
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Typecheck failed." -ForegroundColor Red
    exit 1
  }
}

Write-EasStep "Refreshing App Store provisioning profile"
node (Join-Path $script:MobileRoot "scripts/refresh-ios-appstore-provisioning.cjs")
if ($LASTEXITCODE -ne 0) {
  Write-Host "Provisioning refresh failed." -ForegroundColor Red
  exit 1
}

Write-EasStep "Starting iOS production build on EAS"
$buildArgs = @("build", "--platform", "ios", "--profile", "production")
if ($NonInteractive) {
  $buildArgs += "--non-interactive"
}
Invoke-Eas $buildArgs

if ($Submit) {
  Write-EasStep "Submitting latest build to TestFlight"
  $submitArgs = @("submit", "--platform", "ios", "--latest")
  if ($NonInteractive) {
    $submitArgs += "--non-interactive"
  }
  Invoke-Eas $submitArgs
}

if (-not $SkipEnsureDev) {
  Write-EasStep "Ensuring local dev servers"
  & (Join-Path $script:RepoRoot "scripts\ensure-local-dev.ps1") -RefreshApi
}

Write-EasStep "Done"
Write-Host "Local web: http://localhost:5173/  |  Live: https://vndrly.ai"
