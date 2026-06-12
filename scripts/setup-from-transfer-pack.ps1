# Run once on the NEW machine after extracting the transfer pack.
# Usually invoked as SETUP-NEW-MACHINE.ps1 at the pack root (copied by create-machine-transfer-pack.ps1).
param(
  [string]$InstallPath = "",
  [switch]$SkipInstall,
  [switch]$SkipDeployPreflight
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Msg) {
  Write-Host ""
  Write-Host ">> $Msg" -ForegroundColor Cyan
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Pack root = parent of this script when run as SETUP-NEW-MACHINE.ps1, else script dir's parent for in-repo runs
$PackRoot = $PSScriptRoot
if (-not (Test-Path (Join-Path $PackRoot "VNDRLY.ai"))) {
  $PackRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$BundledRepo = Join-Path $PackRoot "VNDRLY.ai"
$SecretsDir = Join-Path $PackRoot "secrets"

if (-not (Test-Path $BundledRepo)) {
  throw "Bundled repo not found at $BundledRepo — extract the full transfer pack first."
}

Write-Host ""
Write-Host "  VNDRLY — new machine setup" -ForegroundColor Green
Write-Host ""

if (-not $InstallPath) {
  $Default = if ($env:VNDRLY_HOME) { $env:VNDRLY_HOME } else { "C:\Users\JohnElerick\DEV\VNDRLY.ai" }
  Write-Host "Install the repo to a folder on this PC."
  $InstallPath = Read-Host "Target path [$Default]"
  if (-not $InstallPath.Trim()) { $InstallPath = $Default }
}
$InstallPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallPath.Trim())

Write-Step "Installing repo to $InstallPath"
$ResolvedInstall = $null
try { $ResolvedInstall = (Resolve-Path $InstallPath -ErrorAction Stop).Path } catch {}
if ($ResolvedInstall -and ((Resolve-Path $BundledRepo).Path -eq $ResolvedInstall)) {
  Write-Host "Repo already at install path — skipping copy."
} elseif (Test-Path $InstallPath) {
  Write-Host "Target exists — merging/updating files in place."
  $Robo = Start-Process -FilePath "robocopy.exe" -ArgumentList @(
    "`"$BundledRepo`"", "`"$InstallPath`"", "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"
  ) -Wait -PassThru -NoNewWindow
  if ($Robo.ExitCode -ge 8) { throw "robocopy failed ($($Robo.ExitCode))" }
} else {
  New-Item -ItemType Directory -Path (Split-Path $InstallPath -Parent) -Force -ErrorAction SilentlyContinue | Out-Null
  Copy-Item -LiteralPath $BundledRepo -Destination $InstallPath -Recurse -Force
}

Write-Step "Restoring secrets"
. (Join-Path $InstallPath "scripts\secrets-path.ps1")
$LocalSecrets = Get-VndrlySecretsDir -RepoRoot $InstallPath
if (Test-Path $SecretsDir) {
  if (-not (Test-Path $LocalSecrets)) {
    New-Item -ItemType Directory -Path $LocalSecrets -Force | Out-Null
  }
  $Map = @{
    "GoDaddy.env" = Join-Path $LocalSecrets "GoDaddy.env"
    "Supabase.env" = Join-Path $LocalSecrets "Supabase.env"
    "dot-env-local" = Join-Path $InstallPath ".env.local"
    "godaddy-vps.json" = Join-Path $InstallPath ".local\godaddy-vps.json"
  }
  foreach ($entry in $Map.GetEnumerator()) {
    $Src = Join-Path $SecretsDir $entry.Key
    if (Test-Path $Src) {
      $DestDir = Split-Path $entry.Value -Parent
      if ($DestDir -and -not (Test-Path $DestDir)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
      }
      Copy-Item -LiteralPath $Src -Destination $entry.Value -Force
      Write-Host "  restored $($entry.Key) -> $($entry.Value)"
    }
  }
} else {
  Write-Host "  No secrets/ folder — copy API Keys and Secrets\GoDaddy.env, Supabase.env, and .env.local manually."
}

Write-Step "Checking Node.js and pnpm"
if (-not (Test-Command "node")) {
  Write-Host "Install Node.js 20 LTS from https://nodejs.org/ then re-run this script." -ForegroundColor Red
  exit 1
}
Write-Host "  node $(node -v)"
if (-not (Test-Command "pnpm")) {
  Write-Host "  Enabling pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@9.15.9 --activate
}
Write-Host "  pnpm $(pnpm -v)"

if (-not $SkipInstall) {
  Write-Step "pnpm install (may take several minutes)"
  Set-Location $InstallPath
  $env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
}

Write-Step "Updating Start-VNDRLY-Dev.ps1 path"
$StartScript = Join-Path $InstallPath "Start-VNDRLY-Dev.ps1"
if (Test-Path $StartScript) {
  $Content = Get-Content $StartScript -Raw
  $Content = $Content -replace '\$Repo\s*=\s*"[^"]*"', "`$Repo = `"$InstallPath`""
  Set-Content -Path $StartScript -Value $Content -Encoding UTF8
  Write-Host "  Start-VNDRLY-Dev.ps1 -> $InstallPath"
}

Set-Location $InstallPath
if (-not $SkipDeployPreflight) {
  Write-Step "Deploy preflight"
  pnpm run preflight:deploy
}

Write-Host ""
Write-Host "  Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Repo:  $InstallPath"
Write-Host ""
Write-Host "  Local dev:" -ForegroundColor Yellow
Write-Host "    cd `"$InstallPath`""
Write-Host "    pnpm run dev:local"
Write-Host "    — or double-click Start-VNDRLY-Dev.ps1"
Write-Host ""
Write-Host "  Production deploy (after secrets OK + git push):" -ForegroundColor Yellow
Write-Host "    cd `"$InstallPath`""
Write-Host "    pnpm run deploy:production"
Write-Host "    — or full ship:  pnpm run save"
Write-Host ""
Write-Host "  Note: VPS deploy uses GitHub main. Push commits before deploy if needed." -ForegroundColor DarkGray
Write-Host ""
