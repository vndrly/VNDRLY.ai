param(
  [switch]$Submit,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"

function Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Fail($message) {
  Write-Host ""
  Write-Host $message -ForegroundColor Red
  exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not $env:NODE_OPTIONS) {
  $env:NODE_OPTIONS = "--use-system-ca"
} elseif ($env:NODE_OPTIONS -notmatch "--use-system-ca") {
  $env:NODE_OPTIONS = "$env:NODE_OPTIONS --use-system-ca"
}

Step "Checking EAS CLI"
$eas = Join-Path $projectRoot "node_modules\.bin\eas.cmd"
if (!(Test-Path $eas)) {
  Fail "EAS CLI was not found at $eas. Run pnpm install from the repo root first."
}

Step "Checking Expo login"
& $eas whoami --non-interactive
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "You are not logged into Expo yet." -ForegroundColor Yellow
  Write-Host "Run this, complete the browser/password/2FA step, then run this script again:" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  cd $projectRoot"
  Write-Host "  .\node_modules\.bin\eas.cmd login"
  Write-Host ""
  exit 1
}

Step "Checking required TestFlight submit placeholders"
$easJsonPath = Join-Path $projectRoot "eas.json"
$easJsonRaw = Get-Content $easJsonPath -Raw
if ($easJsonRaw -match "REPLACE_WITH_APPLE_ID_EMAIL|REPLACE_WITH_APPLE_TEAM_ID") {
  Write-Host "eas.json still has Apple submit placeholders." -ForegroundColor Yellow
  Write-Host "The build can still be created, but submit will fail until appleId and appleTeamId are filled." -ForegroundColor Yellow
  if ($Submit) {
    Fail "Remove -Submit or fill appleId and appleTeamId in eas.json first."
  }
}

Write-Host ""
Write-Host "NOTE: If a non-interactive build fails with credential validation," -ForegroundColor Yellow
Write-Host "run once interactively: .\node_modules\.bin\eas.cmd build --platform ios --profile production" -ForegroundColor Yellow
Write-Host ""

Step "Running TypeScript check"
pnpm --filter @workspace/vndrly-mobile run typecheck -- --pretty false
if ($LASTEXITCODE -ne 0) {
  Fail "Typecheck failed. Fix the errors above before building."
}

Step "Starting iOS production build for TestFlight"
$buildArgs = @("build", "--platform", "ios", "--profile", "production")
if ($NonInteractive) {
  $buildArgs += "--non-interactive"
}
& $eas @buildArgs
if ($LASTEXITCODE -ne 0) {
  Fail "EAS iOS build failed. Check the EAS URL/log above."
}

if ($Submit) {
  Step "Submitting latest iOS build to TestFlight"
  $submitArgs = @("submit", "--platform", "ios", "--latest")
  if ($NonInteractive) {
    $submitArgs += "--non-interactive"
  }
  & $eas @submitArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "EAS submit failed. Check the App Store Connect/EAS message above."
  }
}

Step "Ensuring local dev servers"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
& (Join-Path $repoRoot "scripts/ensure-local-dev.ps1") -RefreshApi

Step "Done"
Write-Host "If you did not use -Submit, open the EAS build URL above and submit/upload from there."
Write-Host "Local web: http://localhost:5173/  |  Live: https://vndrly.ai"
