# Install CampusIQ Backend Auto-Start
# Creates a Windows Scheduled Task that runs the backend at system startup.

param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$taskName = "CampusIQ Backend Auto-Start"
$scriptPath = Join-Path $ProjectRoot "scripts\campusiq-monitor.ps1"
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $nodePath) {
    Write-Host "ERROR: Node.js is not installed or not in PATH. Cannot install auto-start." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: Monitor script not found at $scriptPath" -ForegroundColor Red
    exit 1
}

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create scheduled task action: run PowerShell with the monitor script
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -WorkingDirectory `"$ProjectRoot`""

# Trigger: at system startup
$trigger = New-ScheduledTaskTrigger -AtStartup

# Settings: run whether user is logged in or not, restart on failure
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

# Register the task with highest privileges
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Auto-starts CampusIQ backend server at boot and keeps it running." -Force -RunLevel Highest

Write-Host ""
Write-Host "=== Auto-Start Installed ===" -ForegroundColor Green
Write-Host "Task Name: $taskName"
Write-Host "Script:    $scriptPath"
Write-Host "Node.js:   $nodePath"
Write-Host ""
Write-Host "The CampusIQ backend will now start automatically when your computer boots." -ForegroundColor Green
Write-Host ""
Write-Host "To manage the task:" -ForegroundColor Yellow
Write-Host "  Open Task Scheduler -> Task Scheduler Library -> '$taskName'"
Write-Host ""
Write-Host "To uninstall auto-start, run: .\scripts\uninstall-autostart.ps1"
Write-Host ""
