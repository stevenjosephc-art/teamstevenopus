# 🚀 Deployment Guide for Google Apps Script

This guide explains how to deploy the recent performance, reliability, and UI improvements to your Google Apps Script (GAS) environment.

---

## 📂 New & Modified Files

Ensure all the following files are present in your GAS project:

### Backend (.gs)
- `Code.gs` (Modified: Added `clientGetDashboardData`)
- `Utilities.gs` (Modified: Added `RateLimiter`, `executeWithErrorHandling`, `logErrorToSheet`)

### Frontend (.html)
- `Index.html` (Modified: Switched to modular CSS, added `ClientCache`, `PerformanceMonitor`, Event Delegation)
- `StyleCritical.html` (New: Root variables and base styles)
- `StyleLayout.html` (New: Sidebar and header layout)
- `StyleComponents.html` (New: Cards, buttons, and status badges)
- `StyleAnimations.html` (New: Transitions and keyframes)
- `StyleDarkMode.html` (New: Dark mode overrides)
- `StyleResponsive.html` (New: Media queries)

---

## 🛠️ Deployment Method 1: Manual (Google Apps Script Editor)

1. **Open your project** at [script.google.com](https://script.google.com).
2. **Create New Files**:
   - For each "New" file listed above, click the **+ (Plus)** icon in the editor.
   - Select **HTML** for the `Style...` files and name them exactly as shown (e.g., `StyleCritical`).
3. **Copy-Paste Code**:
   - Copy the content of each file from this repository and paste it into the corresponding file in the GAS editor.
   - **Note**: Ensure you overwrite the entire content of existing files (`Code.gs`, `Utilities.gs`, `Index.html`).
4. **Save**: Click the Disk icon or press `Cmd/Ctrl + S`.
5. **Deploy**:
   - Click **Deploy** > **Manage Deployments**.
   - Select your active deployment and click **Edit** (pencil icon).
   - Change the version to "New Version" and click **Deploy**.

---

## 💻 Deployment Method 2: CLI (using `clasp`)

If you have `clasp` (Command Line Apps Script Projects) configured locally:

1. **Pull latest changes** from the repository.
2. **Push to Google**:
   ```bash
   clasp push
   ```
3. **Deploy**:
   ```bash
   clasp deploy --description "Phases 1-4 Improvements"
   ```

---

## 🧪 Post-Deployment Verification

1. **Reload the Dashboard**: Open your web app URL.
2. **Check Console**: Press `F12` and check the "Console" tab. You should see `[PERF]` logs and `[ClientCache Hit]` messages as you navigate.
3. **Test Actions**:
   - Claim a task and verify the status badge updates instantly.
   - Verify that the "Home" feed loads faster due to the new batched data retrieval.
4. **Error Logs**: Check the `ErrorLog` sheet in your linked Spreadsheet to ensure no backend errors are being silently swallowed.

---

## ⚠️ Important Note on Script Scopes
These changes do not introduce new scopes, so you should not need to re-authorize the app unless your deployment configuration has changed.
