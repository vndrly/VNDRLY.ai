# Double-click to run VNDRLY locally (web + API).
# Opens two terminal windows (API + web). Use keep-dev-awake.ps1 to auto-restart
# after sleep and prevent Windows from sleeping while you work.

$Repo = "C:\Users\JohnElerick\DEV\VNDRLY.ai"
$NodeDir = "C:\Users\JohnElerick\DEV\tools\node"
Set-Location $Repo
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
powershell -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts/ensure-local-dev.ps1") -RefreshApi -OpenBrowser

