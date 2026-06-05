# Double-click this file to run VNDRLY on this PC (web + API).
# Keeps two small terminal windows open while you work; close them to stop.

$Repo = "c:\Users\JohnElerick\VNDRLY.ai"
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:VNDRLY_LOAD_ENV_LOCAL = "1"

Set-Location $Repo

# Build API once if needed
if (-not (Test-Path "$Repo\artifacts\api-server\dist\index.mjs")) {
  npm exec --yes pnpm@9.15.9 -- --filter @workspace/api-server run build
}

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "`$env:Path='C:\Program Files\nodejs;' + `$env:APPDATA + '\npm;' + `$env:Path'; `$env:NODE_OPTIONS='--use-system-ca'; `$env:VNDRLY_LOAD_ENV_LOCAL='1'; Set-Location '$Repo'; node scripts/run-api-local.mjs"
)

Start-Sleep -Seconds 4

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "`$env:Path='C:\Program Files\nodejs;' + `$env:APPDATA + '\npm;' + `$env:Path'; `$env:NODE_OPTIONS='--use-system-ca'; `$env:VNDRLY_LOAD_ENV_LOCAL='1'; Set-Location '$Repo'; node scripts/run-vite-local.mjs"
)

Start-Sleep -Seconds 6
Start-Process "http://localhost:5173/"
