# Double-click to run VNDRLY locally (web + API) with auto-restart + anti-sleep.
# For one-shot start without watch, use: pnpm wake

$Repo = "C:\Users\JohnElerick\DEV\VNDRLY.ai"
$NodeDir = "C:\Users\JohnElerick\DEV\tools\node"
Set-Location $Repo
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
npm exec --yes pnpm@9.15.9 run dev:watch

