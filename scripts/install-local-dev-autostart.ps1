# Register a logon task that keeps http://localhost:5173/ and :8080 alive.
# Uninstall: pnpm dev:autostart:uninstall

$ErrorActionPreference = "Stop"

$Repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$watchScript = Join-Path $Repo "scripts\keep-dev-awake.ps1"
$taskName = "VNDRLY Local Dev Watch"

if (-not (Test-Path $watchScript)) {
  throw "Missing watch script: $watchScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Minimized -NoExit -ExecutionPolicy Bypass -File `"$watchScript`"" `
  -WorkingDirectory $Repo

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Keeps VNDRLY local web (:5173) and API (:8080) running; auto-restarts if hung." `
  -Force | Out-Null

Write-Host ""
Write-Host "Installed logon task: $taskName"
Write-Host "  Starts: keep-dev-awake.ps1 (minimized PowerShell at sign-in)"
Write-Host "  URLs:   http://localhost:5173/  |  http://localhost:8080/"
Write-Host ""
Write-Host "Start watch now without signing out:"
Write-Host "  pnpm dev:watch"
Write-Host ""
Write-Host "Remove autostart:"
Write-Host "  pnpm dev:autostart:uninstall"
Write-Host ""
