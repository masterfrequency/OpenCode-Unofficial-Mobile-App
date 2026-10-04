$ErrorActionPreference = "Stop"
$gatewayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $gatewayRoot "start.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "OpenCode Unofficial Gateway" -Action $action -Trigger $trigger -Settings $settings -Description "Starts the local authenticated OpenCode mobile gateway at sign-in." -Force | Out-Null
Write-Host "Installed. The gateway will start at Windows sign-in." -ForegroundColor Cyan
Write-Host "Run .\start.ps1 once now to create and display the persistent pairing token." -ForegroundColor Yellow
