# Double-click to run VNDRLY locally (web + API).
# Keeps two small terminal windows open while you work; close them to stop.

$Repo = "c:\Users\JohnElerick\VNDRLY.ai"
Set-Location $Repo
powershell -ExecutionPolicy Bypass -File (Join-Path $Repo "scripts/ensure-local-dev.ps1") -RefreshApi -OpenBrowser
