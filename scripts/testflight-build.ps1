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
