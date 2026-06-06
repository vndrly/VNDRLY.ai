$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"
$env:VNDRLY_LOAD_ENV_LOCAL = "1"
Set-Location $Repo
node (Join-Path $Repo "scripts/run-api-local.mjs")
