param(
  [string]$Message = "",
  [switch]$SkipCommit
)

$ErrorActionPreference = "Stop"

function Run-Git {
  param([string[]]$ArgsList)
  & git @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "git $($ArgsList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Read-Pat {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $null }
  $raw = (Get-Content $Path -Raw).Trim()
  if (-not $raw) { return $null }
  return $raw
}

$root = (& git rev-parse --show-toplevel).Trim()
Set-Location $root

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "Cannot publish from a detached HEAD. Check out a branch first."
}

$remote = "origin"
$remoteBranch = "main"
$patFile = Join-Path (Split-Path $root -Parent) "GitHub_PAT.env"

if (-not $SkipCommit) {
  Run-Git @("add", "-u")

  $untracked = @(
    & git ls-files --others --exclude-standard | Where-Object {
      $_ -notmatch "\.log$" -and
      $_ -notmatch "\.zip$" -and
      $_ -notmatch "(^|/)node_modules/" -and
      $_ -notmatch "(^|/)\.pnpm-store/" -and
      $_ -notmatch "(^|/)\.tmp_"
    }
  )

  if ($untracked.Count -gt 0) {
    Run-Git (@("add", "--") + $untracked)
  }

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
Write-Host "Pushing $branch -> $pushTarget ..."

try {
  Run-Git @("push", $remote, "HEAD:${remoteBranch}")
} catch {
  $pat = Read-Pat $patFile
  if (-not $pat) { throw }
  $repoUrl = (& git remote get-url $remote).Trim()
  if ($repoUrl -notmatch "github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)") {
    throw "Could not parse GitHub remote URL: $repoUrl"
  }
  $owner = $Matches.owner
  $repo = $Matches.repo -replace '\.git$', ''
  $authUrl = "https://${owner}:${pat}@github.com/${owner}/${repo}.git"
  Run-Git @("push", $authUrl, "HEAD:${remoteBranch}")
}

$head = (& git rev-parse HEAD).Trim()
Write-Host ""
Write-Host "Pushed to GitHub: $head on $pushTarget"
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
