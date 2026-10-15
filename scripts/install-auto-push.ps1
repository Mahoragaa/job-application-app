<#
.SYNOPSIS
  Registers (or removes) a Windows scheduled task that runs scripts/auto-push.ps1 every hour.

.EXAMPLE
  npm run autopush:install            # every 60 minutes (default)
  powershell -File scripts/install-auto-push.ps1 -IntervalMinutes 30
  npm run autopush:uninstall
#>
param(
  [int]$IntervalMinutes = 60,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$taskName = "JobTracker-AutoPush"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task '$taskName'."
  exit 0
}

$script = Join-Path $PSScriptRoot "auto-push.ps1"
$psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# conhost --headless runs the console app with no window flash (Windows 10 21H2+ / 11)
$action = New-ScheduledTaskAction -Execute "conhost.exe" `
  -Argument "--headless powershell.exe $psArgs" `
  -WorkingDirectory (Split-Path -Parent $PSScriptRoot)

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Runs as you, only while you're logged on (uses your existing Git credentials; no password stored)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description "Auto-commit and push the Job Tracker repo to GitHub every $IntervalMinutes minutes." | Out-Null

Write-Host "Scheduled task '$taskName' registered: runs every $IntervalMinutes minutes."
Write-Host "Log file: $(Join-Path (Split-Path -Parent $PSScriptRoot) '.git\auto-push.log')"
