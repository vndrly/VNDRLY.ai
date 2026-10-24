# Double-click to run VNDRLY locally (web + API) with auto-restart + anti-sleep.
# For one-shot start without watch, use: pnpm wake

$Repo = $PSScriptRoot
$NodeDir = Join-Path $Repo ".local\tools"
Set-Location $Repo
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
npm exec --yes pnpm@9.15.9 run dev:watch

