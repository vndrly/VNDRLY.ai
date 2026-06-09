function Get-VndrlySecretsDir {
  param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  )
  if ($env:VNDRLY_SECRETS_DIR) {
    return $env:VNDRLY_SECRETS_DIR
  }
  return Join-Path (Split-Path $RepoRoot -Parent) "API Keys and Secrets"
}
