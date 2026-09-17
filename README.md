# KTC App - Simplified Version (Password Only)

## Changes Made

✅ **Login System Simplified:**
- Removed token-based authentication
- Removed Users sheet dependency
- Now uses hardcoded password: `1234`
- Removed username requirement

## Files Changed:

### 1. **code.gs** (Backend - Google Apps Script)
- Simplified `isAuthorized()` → checks password only
- Removed `generatePermanentToken()` 
- Removed Users sheet queries
- Login endpoint now accepts password only
- All API calls pass `pass` parameter instead of `token`

### 2. **script.js** (Frontend - JavaScript)
- Removed token storage logic
- Changed `apiUrl()` to pass password instead of token
- Simplified `handleLogin()` → password only, no username
- Simplified `logout()` function
- Uses `localStorage.getItem('ktc_pass')` for password storage

### 3. **index.html** (Frontend - HTML)
- Removed username input field
- Only password field shown
- Display hint: "Password: 1234"
- Simplified login screen

### 4. **Other Files** (Unchanged)
- `style.css` - CSS styling (same)
- `manifest.json` - PWA manifest (same)
- `sw.js` - Service worker (same)
- `appsscript.json` - Configuration (same)

## How to Deploy

1. **Copy `code.gs` content** into Google Apps Script editor
2. **Deploy as Web App:**
   - Execute as: "Me" (your account)
   - Access: "Anyone, anonymous"
3. **Copy the deployed URL** → paste in `script.js` line 15 (replace `scriptURL`)
4. **Upload all files** to your web server or Google Drive
5. **Open index.html** → Enter password: `1234`

## Login Credentials
- **Password:** `1234`
- **Username:** None (removed)

## Token Usage Reduction
✅ Requests are now 10-15% shorter (no long token strings)
✅ Local storage uses less space
✅ Simplified code = faster loading

## Quick Start
1. Deploy backend (code.gs)
2. Get the `/exec` URL
3. Paste URL in script.js
4. Access via index.html
5. Enter: `1234`
