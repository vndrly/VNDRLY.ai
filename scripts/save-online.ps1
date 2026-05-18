param(
  [string]$Message = ""
)

$ErrorActionPreference = "Stop"

function Run-Git {
  param([string[]]$ArgsList)
  & git @ArgsList
  if ($LASTEXITCODE -ne 0) {
    throw "git $($ArgsList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

$root = (& git rev-parse --show-toplevel).Trim()
Set-Location $root

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "Cannot save from a detached HEAD. Check out a branch first."
}

$remote = (& git config --get "branch.$branch.remote").Trim()
if (-not $remote) {
  $remote = "origin"
}

$mergeRef = (& git config --get "branch.$branch.merge").Trim()
if ($mergeRef -match "^refs/heads/(.+)$") {
  $remoteBranch = $Matches[1]
} else {
  $remoteBranch = $branch
}

Run-Git @("add", "-u")

$untracked = & git ls-files --others --exclude-standard
$untracked = @(
  $untracked | Where-Object {
    $_ -notmatch "\.log$" -and
    $_ -notmatch "\.zip$" -and
    $_ -notmatch "(^|/)node_modules/" -and
    $_ -notmatch "(^|/)\.pnpm-store/"
  }
)

if ($untracked.Count -gt 0) {
  Run-Git (@("add", "--") + $untracked)
}

$staged = (& git diff --cached --name-only)
if (-not $staged) {
  Write-Host "No source changes to save."
  exit 0
}

if (-not $Message.Trim()) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
  $Message = "Save updates $timestamp"
}

Run-Git @("commit", "-m", $Message)
Run-Git @("push", $remote, "HEAD:$remoteBranch")

Write-Host "Saved online: pushed $branch to $remote/$remoteBranch."
