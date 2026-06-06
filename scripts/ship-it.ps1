# Ship it — typecheck, commit, push, deploy web, EAS iOS build + TestFlight submit.
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"

function Write-ShipStep {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> Ship it: $Message" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  Ship it" -ForegroundColor Green
Write-Host ""

if (-not $Message.Trim()) {
  $Message = "Ship it $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-ShipStep "Typechecking workspace (stop here if anything is broken)"
pnpm run typecheck
if ($LASTEXITCODE -ne 0) {
  Write-Host "Typecheck failed. Fix errors before shipping." -ForegroundColor Red
  exit 1
}

Write-ShipStep "Committing and pushing to GitHub"
$publishArgs = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "publish-online.ps1"), "-SkipDeploy", "-SkipTypecheck")
if ($Message.Trim()) {
  $publishArgs += @("-Message", $Message)
}
& powershell @publishArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-ShipStep "Deploying web to production"
node (Join-Path $Root "scripts/deploy.mjs")
if ($LASTEXITCODE -ne 0) {
  Write-Host "Production deploy failed." -ForegroundColor Red
  exit 1
}

Write-ShipStep "Building iOS on EAS and submitting to TestFlight"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "testflight-build.ps1") -Submit -NonInteractive -SkipTypecheck -SkipEnsureDev
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-ShipStep "Restarting local dev servers"
& (Join-Path $PSScriptRoot "ensure-local-dev.ps1") -RefreshApi

Write-Host ""
Write-Host "Ship it complete." -ForegroundColor Green
Write-Host "  Live:       https://vndrly.ai"
Write-Host "  Local:      http://localhost:5173/"
Write-Host "  TestFlight: https://appstoreconnect.apple.com/apps/6771456209/testflight/ios"
