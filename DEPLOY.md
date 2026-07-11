# CampusIQ — Deployment Guide

## 🚀 Deploy to Vercel in 5 Minutes

### Step 1: Push to GitHub
```bash
cd campusiq-kstu
git init
git add .
git commit -m "CampusIQ fullstack v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/papi-coder.git
git push -u origin main
```

### Step 2: Deploy on Vercel
1. Go to vercel.com → New Project → Import your `papi-coder` repo
2. Framework Preset: **Other**
3. Root Directory: leave as `/`
4. Click **Deploy**

### Step 3: Access Your Live Site
After deploy your URLs will be:
```
Landing page:   https://campusiqkstu1.vercel.app/
Student app:    https://campusiqkstu1.vercel.app/frontend/index.html
Admin backend:  https://campusiqkstu1.vercel.app/backend/admin.html
```

---

## ⚠️ Important: Data Persistence on Vercel

The current setup uses **JSON files stored in /tmp** on Vercel serverless functions.

**What this means:**
- ✅ Works perfectly for testing and demos
- ✅ Admin can create accounts and students can log in immediately
- ⚠️ Data may reset on new deployments or after Vercel cold starts (typically every few hours of inactivity)

**For full production persistence** (data never resets), add Vercel KV:

### Add Vercel KV (Free Tier — 30 seconds setup)
1. Go to your Vercel project dashboard
2. Click **Storage** tab → **Create Database** → **KV**
3. Name it `campusiq-kv`, click Create
4. Click **Connect to Project** → your project
5. Redeploy — done. Your data now persists forever.

*(No code changes needed — the app is pre-wired for this upgrade)*

---

## 🔐 Default Login
- **Admin:** username `admin` / password `admin123`
- Change the admin password immediately after first login via Settings

## 👥 Creating Student/Lecturer Accounts
1. Login to Admin Backend
2. Click **Students** → **+ Add Student**
3. Fill name, email, password, student ID, programme, level
4. Click **Create Account** — credentials shown on screen
5. Student can **immediately** log in at the Student Portal with those exact details

---

## 🧑‍💻 Running Locally

```bash
npm install
node api/index.js
# API runs at http://localhost:3001

# Open frontend pages directly in your browser:
# public/frontend/index.html
# public/backend/admin.html
```
