param(
  [string]$Message = "",
  [switch]$SkipCommit,
  [switch]$SkipDeploy,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "ship-common.ps1")

function Run-Git {
  param([string[]]$ArgsList)
  & git @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "git $($ArgsList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

# GitHub push uses vndrly org PAT only (no credential-manager fallback).
$script:GitHubPatFile = "C:\Users\JohnElerick\OneDrive - Elerick.com\Desktop\VNDRLY-GitHub-PAT.env"
$script:GitHubOwner = "vndrly"
$script:GitHubRepo = "VNDRLY.ai"

function Read-Pat {
  if (-not (Test-Path $script:GitHubPatFile)) {
    throw "GitHub PAT not found: $($script:GitHubPatFile)"
  }
  $raw = (Get-Content $script:GitHubPatFile -Raw).Trim()
  if (-not $raw) {
    throw "GitHub PAT file is empty: $($script:GitHubPatFile)"
  }
  return $raw
}

$root = (& git rev-parse --show-toplevel).Trim()
Set-Location $root
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$env:NODE_OPTIONS = "--use-system-ca"

if (-not $SkipTypecheck) {
  Write-Host ""
  Write-Host "==> Typechecking workspace..." -ForegroundColor Cyan
  pnpm run typecheck
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Typecheck failed. Fix errors before publishing." -ForegroundColor Red
    exit 1
  }
}

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "Cannot publish from a detached HEAD. Check out a branch first."
}

$remote = "origin"
$remoteBranch = "main"

if (-not $SkipCommit) {
  Add-GitShipChanges -Root $root

  $staged = (& git diff --cached --name-only)
  if (-not $staged) {
    Write-Host "No source changes to commit."
  } else {
    if (-not $Message.Trim()) {
      $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
      $Message = "Publish updates $timestamp"
    }
    Run-Git @("commit", "-m", $Message)
  }
}

$pushTarget = "${remote}/${remoteBranch}"
Write-Host "Pushing $branch -> $pushTarget (vndrly via PAT) ..."

Push-VndrlyGitHub -RemoteBranch $remoteBranch

$head = (& git rev-parse HEAD).Trim()
Write-Host ""
Write-Host "Pushed to GitHub: $head on $pushTarget"

if ($SkipDeploy) {
  Write-Host "Skipping deploy (caller handles deploy/build)."
  exit 0
}

Write-Host "Deploying..."

node (Join-Path $root "scripts/deploy.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Production deploy failed."
}

Write-Host ""
Write-Host "Done. Changes pushed and deployed from Cursor."
$liveUrlFile = Join-Path $root ".local/live-url.txt"
if (Test-Path $liveUrlFile) {
  $liveUrl = (Get-Content $liveUrlFile -Raw).Trim()
  if ($liveUrl) { Write-Host "Live URL: $liveUrl" }
}
Write-Host "iOS still needs a separate EAS build when mobile code changes."
Write-Host "Run:  pnpm run `"ship it`""

Write-Host ""
Write-Host "Ensuring local dev servers (http://localhost:5173/) ..."
& (Join-Path $root "scripts/ensure-local-dev.ps1") -RefreshApi
