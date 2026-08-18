# CampusIQ — One-Time Setup for Always-On Backend

Follow these steps ONCE. After that, the backend will start automatically when your computer turns on, and your mobile app will connect without any manual steps.

---

## Step 1: Install Auto-Start (ONE TIME)

Open PowerShell as Administrator and run:

```powershell
cd "C:\Users\USER\Downloads\campusiq_kstu_fullstack (1)\campusiq-fullstack"
.\scripts\install-autostart.ps1
```

This creates a Windows Scheduled Task that starts the CampusIQ backend automatically every time your computer boots.

---

## Step 2: Allow Mobile Access Through Firewall (ONE TIME)

Still in Administrator PowerShell:

```powershell
.\scripts\add-firewall-rule.ps1
```

This opens ports 3001-3010 in Windows Firewall so your mobile phone on the same WiFi can reach the backend.

---

## Step 3: Restart Your Computer

After restarting, the backend starts automatically in the background.

---

## How to Access

### From your computer:
- Open browser: `http://localhost:3001`

### From your mobile phone (same WiFi):
1. Find your computer's local IP address (e.g., `192.168.1.15`)
2. On your phone browser, open: `http://192.168.1.15:3001`
3. Sign in normally — the app will find the backend automatically

---

## Manual Controls (if needed)

| Action | Command |
|--------|---------|
| Start server manually | `.\scripts\start-campusiq.bat` |
| Stop server manually | `.\scripts\stop-campusiq.bat` |
| Check server is running | `netstat -ano \| findstr :3001` |
| View server logs | `.\logs\server.log` |

---

## Troubleshooting

**Mobile still shows "Offline — API unavailable":**
1. Make sure your phone and computer are on the **same WiFi network**
2. Make sure the backend is running: check `http://localhost:3001/api/health` on your computer
3. Make sure Windows Firewall allows ports 3001-3010 (run `.\scripts\add-firewall-rule.ps1`)
4. Hard refresh the mobile browser (close all tabs and reopen)

**Backend keeps crashing:**
- Check `.\logs\server.log` for errors
- Make sure Node.js is installed: `node --version`

**To remove auto-start:**
```powershell
.\scripts\uninstall-autostart.ps1
```
