# Mobile bridge CLI — needs Windows system CA certs for Node HTTPS.
$env:NODE_OPTIONS = "--use-system-ca"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
npx cursor-bridge @args
