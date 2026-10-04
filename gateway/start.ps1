$ErrorActionPreference = "Stop"

if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) {
    throw "OpenCode is not installed or is not on PATH."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 20 or newer is required."
}

$gatewayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$tokenFile = Join-Path $gatewayRoot ".gateway-token"
if ([string]::IsNullOrWhiteSpace($env:OPENCODE_REMOTE_TOKEN) -and (Test-Path $tokenFile)) {
    $env:OPENCODE_REMOTE_TOKEN = (Get-Content $tokenFile -Raw).Trim()
}
if ([string]::IsNullOrWhiteSpace($env:OPENCODE_REMOTE_TOKEN)) {
    $bytes = New-Object byte[] 32
    $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $env:OPENCODE_REMOTE_TOKEN = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
    Set-Content -Path $tokenFile -Value $env:OPENCODE_REMOTE_TOKEN -NoNewline
}

Write-Host ""
Write-Host "The gateway token is stored locally. A six-digit pairing code will be shown next." -ForegroundColor Cyan
Write-Host "Keep this window open. OpenCode: 127.0.0.1:4096; gateway: 127.0.0.1:4174" -ForegroundColor Cyan

$backend = Start-Process -FilePath "opencode" -ArgumentList @("serve", "--hostname", "127.0.0.1", "--port", "4096") -PassThru -NoNewWindow
try {
    & node (Join-Path $gatewayRoot "server.mjs")
}
finally {
    if ($backend -and -not $backend.HasExited) {
        Stop-Process -Id $backend.Id -Force
    }
}
