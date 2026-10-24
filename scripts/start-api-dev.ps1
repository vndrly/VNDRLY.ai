$ErrorActionPreference = "Stop"
$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeDir = Join-Path $Repo ".local\tools"
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$env:VNDRLY_LOAD_ENV_LOCAL = "1"
Set-Location $Repo
node (Join-Path $Repo "scripts/run-api-local.mjs")
