param(
  [switch]$Submit,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$args = @("-ExecutionPolicy", "Bypass", "-File", (Join-Path $repoRoot "scripts\testflight-build.ps1"))
if ($Submit) { $args += "-Submit" }
if ($NonInteractive) { $args += "-NonInteractive" }
& powershell @args
exit $LASTEXITCODE
