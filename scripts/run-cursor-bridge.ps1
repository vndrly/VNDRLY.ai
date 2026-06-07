# IDE For Cursor mobile bridge — VNDRLY-patched (Windows auth + stable pairing).
$env:NODE_OPTIONS = "--use-system-ca"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$BridgeDir = Join-Path $PSScriptRoot "cursor-bridge"
Set-Location $Root

if (-not (Test-Path (Join-Path $BridgeDir "node_modules\sql.js"))) {
  Write-Host "Installing cursor-bridge dependencies (first run)..." -ForegroundColor Cyan
  Push-Location $BridgeDir
  pnpm install --ignore-workspace
  if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw "cursor-bridge dependency install failed"
  }
  Pop-Location
}

node (Join-Path $BridgeDir "index.mjs") @args
