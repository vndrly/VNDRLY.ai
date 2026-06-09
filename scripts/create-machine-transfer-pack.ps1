# Creates a one-time zip for moving VNDRLY dev + deploy tooling to a new Windows machine.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/create-machine-transfer-pack.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/create-machine-transfer-pack.ps1 -OutputPath "E:\VNDRLY-transfer.zip"
param(
  [string]$OutputPath = "",
  [switch]$SkipSecrets
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Stamp = Get-Date -Format "yyyyMMdd-HHmm"
$PackName = "VNDRLY-machine-transfer-$Stamp"
$WorkDir = Join-Path $env:TEMP $PackName
$RepoDest = Join-Path $WorkDir "VNDRLY.ai"
$SecretsDir = Join-Path $WorkDir "secrets"

function Write-Step([string]$Msg) {
  Write-Host ""
  Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Get-GitInfo([string]$Dir) {
  Push-Location $Dir
  try {
    $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
    if (-not $branch) { $branch = "unknown" }
    $commit = (git rev-parse HEAD 2>$null)
    if (-not $commit) { $commit = "unknown" }
    $short = (git rev-parse --short HEAD 2>$null)
    $dirty = $false
    $ErrorActionPreference = "SilentlyContinue"
    git diff --quiet 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $dirty = $true }
    git diff --cached --quiet 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $dirty = $true }
    $ErrorActionPreference = "Stop"
    return @{ branch = $branch; commit = $commit; short = $short; dirty = $dirty }
  } finally {
    Pop-Location
  }
}

function Copy-SecretIfExists([string]$Source, [string]$DestName) {
  if (Test-Path $Source) {
    Copy-Item -LiteralPath $Source -Destination (Join-Path $SecretsDir $DestName) -Force
    return $true
  }
  return $false
}

Write-Host ""
Write-Host "  VNDRLY machine transfer pack builder" -ForegroundColor Green
Write-Host "  Source: $Root"
Write-Host ""

if (Test-Path $WorkDir) {
  Remove-Item -LiteralPath $WorkDir -Recurse -Force
}
New-Item -ItemType Directory -Path $RepoDest -Force | Out-Null
New-Item -ItemType Directory -Path $SecretsDir -Force | Out-Null

Write-Step "Copying repository (excluding node_modules, build caches, large zips)..."
$ExcludeDirs = @(
  "node_modules",
  "dist",
  ".turbo",
  ".expo",
  "coverage",
  "playwright-report",
  "test-results",
  ".next",
  "android",
  "ios",
  ".gradle"
)
$Xd = ($ExcludeDirs | ForEach-Object { "/XD"; $_ }) -join " "
$RoboArgs = @(
  "`"$Root`"",
  "`"$RepoDest`"",
  "/MIR",
  "/XD", "node_modules", "dist", ".turbo", ".expo", "coverage", "playwright-report", "test-results", ".next", "android", "ios", ".gradle",
  "/XF", "artifacts/vndrly-mobile.zip",
  "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"
)
$Robo = Start-Process -FilePath "robocopy.exe" -ArgumentList $RoboArgs -Wait -PassThru -NoNewWindow
if ($Robo.ExitCode -ge 8) {
  throw "robocopy failed with exit code $($Robo.ExitCode)"
}

Write-Step "Copying setup entry script to pack root..."
Copy-Item -LiteralPath (Join-Path $Root "scripts\setup-from-transfer-pack.ps1") `
  -Destination (Join-Path $WorkDir "SETUP-NEW-MACHINE.ps1") -Force
Copy-Item -LiteralPath (Join-Path $Root "docs\machine-transfer-pack.md") `
  -Destination (Join-Path $WorkDir "README-MACHINE-TRANSFER.md") -Force

Write-Step "Collecting secrets (stored only inside this zip - guard the drive)..."
$SecretNotes = @()
if (-not $SkipSecrets) {
  . (Join-Path $Root "scripts\secrets-path.ps1")
  $LocalSecrets = Get-VndrlySecretsDir -RepoRoot $Root
  if (Copy-SecretIfExists (Join-Path $LocalSecrets "GoDaddy.env") "GoDaddy.env") {
    $SecretNotes += "GoDaddy.env"
  }
  if (Copy-SecretIfExists (Join-Path $LocalSecrets "Supabase.env") "Supabase.env") {
    $SecretNotes += "Supabase.env"
  }
  if (Copy-SecretIfExists (Join-Path $Root ".env.local") "dot-env-local") {
    $SecretNotes += "dot-env-local (.env.local)"
  }
  $LocalGodaddy = Join-Path $Root ".local\godaddy-vps.json"
  if (Copy-SecretIfExists $LocalGodaddy "godaddy-vps.json") {
    $SecretNotes += "godaddy-vps.json"
  }
} else {
  $SecretNotes += "(skipped - use -SkipSecrets)"
}

@"
VNDRLY machine transfer — secrets folder
=======================================

These files are NOT in git. Keep the zip drive private.

On the new machine, run SETUP-NEW-MACHINE.ps1 from the pack root.
It copies these files to the correct locations automatically.

Included in this pack:
$(if ($SecretNotes.Count -eq 0) { "  (none - add API Keys and Secrets\GoDaddy.env, Supabase.env, and repo .env.local before re-packing)" } else { ($SecretNotes | ForEach-Object { "  - $_" }) -join "`n" })

If anything is missing, copy manually before deploy:
  DEV\API Keys and Secrets\GoDaddy.env   — vps_ip, ssh_pass, optional api_key/api_secret
  DEV\API Keys and Secrets\Supabase.env  — Supabase DB password reference
  repo\.env.local       — DATABASE_URL, SESSION_SECRET, service role key, etc.
"@ | Set-Content -Path (Join-Path $SecretsDir "INSTRUCTIONS.txt") -Encoding UTF8

Write-Step "Writing manifest..."
$Git = Get-GitInfo $Root
$NodeVer = ""
try { $NodeVer = (node -v 2>$null).Trim() } catch {}
$Manifest = @{
  packVersion = 1
  createdAt = (Get-Date).ToString("o")
  sourceMachine = $env:COMPUTERNAME
  sourcePath = $Root
  gitBranch = $Git.branch
  gitCommit = $Git.commit
  gitCommitShort = $Git.short
  gitDirty = $Git.dirty
  nodeVersion = $NodeVer
  pnpmVersion = "9.15.9"
  secretsIncluded = $SecretNotes
  productionNote = "deploy:production pulls origin/main on the VPS. Push GitHub before deploy if you need server to match uncommitted pack files."
} | ConvertTo-Json -Depth 4
$Manifest | Set-Content -Path (Join-Path $WorkDir "MANIFEST.json") -Encoding UTF8

if (-not $OutputPath) {
  $Removable = Get-Volume -ErrorAction SilentlyContinue |
    Where-Object { $_.DriveType -eq "Removable" -and $_.DriveLetter } |
    Select-Object -First 1
  if ($Removable) {
    $OutputPath = "$($Removable.DriveLetter):\$PackName.zip"
  } else {
    $OutputPath = Join-Path (Split-Path $Root -Parent) "$PackName.zip"
  }
}

Write-Step "Creating zip: $OutputPath"
if (Test-Path $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}
Compress-Archive -LiteralPath $WorkDir -DestinationPath $OutputPath -CompressionLevel Optimal

Remove-Item -LiteralPath $WorkDir -Recurse -Force

Write-Host ""
Write-Host "  Pack ready." -ForegroundColor Green
Write-Host "  Zip: $OutputPath"
Write-Host "  Git: $($Git.branch) @ $($Git.short)$(if ($Git.dirty) { ' (uncommitted changes included)' })"
Write-Host ""
Write-Host "  On the new machine:" -ForegroundColor Yellow
Write-Host "    1. Copy/extract the zip anywhere (USB drive OK)"
Write-Host "    2. Open the extracted folder"
Write-Host "    3. Run:  powershell -ExecutionPolicy Bypass -File .\SETUP-NEW-MACHINE.ps1"
Write-Host ""
