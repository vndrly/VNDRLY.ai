# Double-click to run VNDRLY locally (web + API).
# Keeps two small terminal windows open while you work; close them to stop.

$Repo = "C:\Users\JohnElerick\DEV\VNDRLY.ai"
$NodeDir = "C:\Users\JohnElerick\DEV\tools\node"
Set-Location $Repo
$env:Path = "$NodeDir;C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
powershell -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts/ensure-local-dev.ps1") -RefreshApi -OpenBrowser

