# Production API smoke test for vndrly.ai
$Base = "https://vndrly.ai"
$Personas = @(
  @{ Name = "admin"; User = "admin"; Pass = "vndrly123" },
  @{ Name = "partner"; User = "exxon"; Pass = "exxon123" },
  @{ Name = "vendor"; User = "baker"; Pass = "baker123" }
)
$Endpoints = @(
  "/api/health",
  "/api/dashboard/summary",
  "/api/tickets?limit=3",
  "/api/site-locations",
  "/api/notifications/unread-count",
  "/api/notifications?limit=5",
  "/api/hotlist/jobs",
  "/api/safety/metrics",
  "/api/safety/events?limit=5",
  "/api/tickets/flagged",
  "/api/assistant/conversations"
)

$results = @()
foreach ($p in $Personas) {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $body = @{ username = $p.User; password = $p.Pass } | ConvertTo-Json
  try {
    $login = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method POST -Body $body -ContentType "application/json" -WebSession $session -UseBasicParsing
    $loginOk = $login.StatusCode
  } catch {
    $loginOk = "ERR:$($_.Exception.Response.StatusCode.value__)"
    $results += [PSCustomObject]@{ Persona = $p.Name; Endpoint = "LOGIN"; Status = $loginOk; Note = $_.Exception.Message }
    continue
  }
  foreach ($ep in $Endpoints) {
    try {
      $r = Invoke-WebRequest -Uri "$Base$ep" -WebSession $session -UseBasicParsing
      $results += [PSCustomObject]@{ Persona = $p.Name; Endpoint = $ep; Status = $r.StatusCode; Note = "" }
    } catch {
      $code = $_.Exception.Response.StatusCode.value__
      $note = ""
      try {
        $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $note = $sr.ReadToEnd().Substring(0, [Math]::Min(120, $sr.ReadToEnd().Length))
      } catch {}
      $results += [PSCustomObject]@{ Persona = $p.Name; Endpoint = $ep; Status = $code; Note = $note }
    }
  }
}

$out = "c:\Users\JohnElerick\DEV\VNDRLY.ai\docs\_smoke-api-results.txt"
$results | Format-Table -AutoSize | Out-String | Set-Content $out
$results | ConvertTo-Csv -NoTypeInformation | Add-Content $out
Write-Output "Wrote $($results.Count) rows to $out"
$results | Format-Table -AutoSize
