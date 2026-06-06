# Ship it — typecheck, commit, push, deploy web, verify live, EAS iOS + TestFlight, restart local dev.
param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ship-common.ps1")

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:EAS_BUILD_NO_EXPO_GO_WARNING = "true"

$Summary = @{}

function Fail-Ship {
  param(
    [string]$Step,
    [string]$Reason
  )
  Write-ShipFailure -Step $Step -Reason $Reason
  exit 1
}

Write-Host ""
Write-Host "  Ship it" -ForegroundColor Green
Write-Host ""

if (-not $Message.Trim()) {
  $Message = "Ship it $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
}

Write-ShipStep "Typechecking workspace"
pnpm run typecheck
if ($LASTEXITCODE -ne 0) {
  Fail-Ship "Typecheck" "Fix TypeScript errors and run again."
}

Write-ShipStep "Committing and pushing to GitHub"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "publish-online.ps1") -SkipDeploy -SkipTypecheck -Message $Message
if ($LASTEXITCODE -ne 0) {
  Fail-Ship "Commit / push" "git commit or push failed (exit $LASTEXITCODE)."
}
$Summary["Commit"] = (& git rev-parse --short HEAD).Trim()

Write-ShipStep "Deploying web to production"
node (Join-Path $Root "scripts/deploy.mjs")
if ($LASTEXITCODE -ne 0) {
  Fail-Ship "Deploy" "Production deploy script failed."
}

Write-ShipStep "Verifying https://vndrly.ai is live"
node (Join-Path $Root "scripts/check-live.mjs")
if ($LASTEXITCODE -ne 0) {
  Fail-Ship "Live verification" "https://vndrly.ai did not pass smoke checks."
}
$Summary["Live"] = "https://vndrly.ai (verified)"

Write-ShipStep "Building iOS on EAS and submitting to TestFlight"
$iosLog = Join-Path $env:TEMP "vndrly-ship-ios.log"
if (Test-Path $iosLog) { Remove-Item $iosLog -Force }

$prev = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "testflight-build.ps1") `
  -Submit -NonInteractive -SkipTypecheck -SkipEnsureDev *>&1 | Tee-Object -FilePath $iosLog
$iosExit = $LASTEXITCODE
$ErrorActionPreference = $prev

if ($iosExit -ne 0) {
  Fail-Ship "iOS build / TestFlight" "EAS build or submit failed (exit $iosExit). See log: $iosLog"
}

$iosText = Get-Content $iosLog -Raw -ErrorAction SilentlyContinue
if ($iosText -notmatch "Submitted your app to Apple App Store Connect") {
  Fail-Ship "TestFlight submit" "EAS did not confirm App Store Connect upload."
}
if ($iosText -match "Build number:\s+(\d+)") {
  $Summary["iOS build"] = "#$($Matches[1])"
}
if ($iosText -match "builds/([a-f0-9-]{36})") {
  $Summary["TestFlight"] = "https://expo.dev/accounts/vndrlyadmin/projects/vndrly-mobile/builds/$($Matches[1])"
} else {
  $Summary["TestFlight"] = "https://appstoreconnect.apple.com/apps/6771456209/testflight/ios"
}

Write-ShipStep "Restarting local dev servers"
& (Join-Path $PSScriptRoot "ensure-local-dev.ps1") -RefreshApi -Strict
if ($LASTEXITCODE -ne 0) {
  Fail-Ship "Local dev" "Dev servers did not start (ensure-local-dev exit $LASTEXITCODE)."
}
if (-not (Test-LocalDevHealthy)) {
  Fail-Ship "Local dev" "http://localhost:5173 or http://localhost:8080/api/health is not responding."
}
$Summary["Local web"] = "http://localhost:5173/ (verified)"
$Summary["Local API"] = "http://localhost:8080/ (verified)"

Write-ShipSuccess -Summary $Summary
exit 0
