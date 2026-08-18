# Uninstall CampusIQ Backend Auto-Start
# Removes the Windows Scheduled Task that auto-starts the backend.

param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$taskName = "CampusIQ Backend Auto-Start"

# Remove scheduled task
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Remove firewall rule if it exists
Remove-NetFirewallRule -DisplayName "CampusIQ Backend" -ErrorAction SilentlyContinue

Write-Host "Auto-start uninstalled. The backend will no longer start automatically at boot." -ForegroundColor Yellow
Write-Host ""
