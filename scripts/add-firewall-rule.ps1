# Add Windows Firewall Rule for CampusIQ Backend
# Allows incoming connections to the backend server on ports 3001-3010.

$ruleName = "CampusIQ Backend"

# Remove existing rule if present
Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

# Add new rule allowing incoming TCP on ports 3001-3010 for Node.js
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 3001-3010 -Action Allow -ErrorAction SilentlyContinue

Write-Host "Firewall rule added: incoming TCP 3001-3010 allowed." -ForegroundColor Green
Write-Host "Mobile devices on your WiFi can now reach the CampusIQ backend." -ForegroundColor Green
