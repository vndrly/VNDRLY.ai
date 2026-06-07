# Install an EAS iOS Simulator build artifact on the booted Mac simulator.
# Usage:  pnpm run ios:sim:install -- path\to\build.tar.gz

param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ArtifactPath
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command xcrun -ErrorAction SilentlyContinue)) {
  Write-Host "This script requires macOS (xcrun / Simulator)." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $ArtifactPath)) {
  Write-Host "Artifact not found: $ArtifactPath" -ForegroundColor Red
  exit 1
}

$work = Join-Path $env:TEMP "vndrly-sim-install"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

Write-Host "Extracting $ArtifactPath ..."
if ($ArtifactPath -match '\.tar\.gz$') {
  tar -xzf $ArtifactPath -C $work
} elseif ($ArtifactPath -match '\.app$') {
  Copy-Item $ArtifactPath $work -Recurse
} else {
  Write-Host "Expected .tar.gz or .app — got: $ArtifactPath" -ForegroundColor Red
  exit 1
}

$app = Get-ChildItem -Path $work -Filter "*.app" -Recurse | Select-Object -First 1
if (-not $app) {
  Write-Host "No .app bundle found in artifact." -ForegroundColor Red
  exit 1
}

Write-Host "Installing $($app.FullName) on booted simulator ..."
xcrun simctl install booted $app.FullName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Launching com.vndrly.field ..."
xcrun simctl launch booted com.vndrly.field
Write-Host "Done." -ForegroundColor Green
