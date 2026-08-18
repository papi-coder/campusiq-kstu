@echo off
taskkill /FI "WINDOWTITLE eq CampusIQ Backend*" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq CampusIQ*" /F >nul 2>&1
echo CampusIQ backend stopped.
pause
