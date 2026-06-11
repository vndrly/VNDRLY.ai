# Remove VNDRLY local dev watch from Windows logon.

$ErrorActionPreference = "Stop"
$taskName = "VNDRLY Local Dev Watch"

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed scheduled task (if it existed): $taskName"
