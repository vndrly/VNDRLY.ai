# Submit the latest EAS iOS build to TestFlight. Safe to run from repo root.
param(
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "eas-mobile-common.ps1")

Initialize-EasEnvironment
Assert-EasCli

Write-EasStep "Checking Expo login"
Invoke-Eas @("whoami", "--non-interactive")

Write-EasStep "Submitting latest iOS build to TestFlight"
$submitArgs = @("submit", "--platform", "ios", "--latest")
if ($NonInteractive) {
  $submitArgs += "--non-interactive"
}
Invoke-Eas $submitArgs

Write-EasStep "Done"
Write-Host "Track processing: https://appstoreconnect.apple.com/apps/6771456209/testflight/ios"
