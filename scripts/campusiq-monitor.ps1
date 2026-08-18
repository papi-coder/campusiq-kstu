# CampusIQ Backend Auto-Start & Monitor
# Runs the Node.js backend and automatically restarts it if it crashes.

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodePath) {
    Write-Host "ERROR: Node.js is not installed or not in PATH." -ForegroundColor Red
    pause
    exit 1
}

$logFile = Join-Path $projectRoot "logs\server.log"
$logDir = Split-Path -Parent $logFile
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$ts] $msg"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

Write-Log "=== CampusIQ Backend Monitor Starting ==="
Write-Log "Project root: $projectRoot"

while ($true) {
    Write-Log "Starting CampusIQ API server..."
    
    $proc = Start-Process -FilePath "node" -ArgumentList "api/index.js" -WorkingDirectory $projectRoot -PassThru -NoNewWindow
    
    Write-Log "Server started with PID $($proc.Id)"
    
    # Wait for process to exit
    $proc.WaitForExit()
    $exitCode = $proc.ExitCode
    Write-Log "Server exited with code $exitCode"
    
    # Auto-restart after 3 seconds
    Write-Log "Restarting in 3 seconds..."
    Start-Sleep -Seconds 3
}
