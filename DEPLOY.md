# Deployment Guide

This extension is compatible with both Chrome and Firefox.

## Building the Extension Package

Create a zip file for submission to browser extension stores:

```bash
zip -r nostr-wot-extension.zip . -x "*.git*" -x "node_modules/*" -x "*.DS_Store" -x "*.zip" -x ".idea/*" -x ".claude/*"
```

### Excluded Files

| Pattern | Reason |
|---------|--------|
| `*.git*` | Git version control files (history, config) |
| `node_modules/*` | NPM dependencies (not needed, extension has no build step) |
| `*.DS_Store` | macOS system files |
| `*.zip` | Previously built packages |
| `.idea/*` | JetBrains IDE configuration |
| `.claude/*` | Claude Code configuration |

### Files That ARE Included

- `manifest.json` - Extension manifest
- `background.js` - Service worker
- `content.js` - Content script (messaging bridge)
- `inject.js` - Page script (exposes window.nostr.wot)
- `popup/` - Popup UI (HTML, CSS, JS)
- `lib/` - Shared libraries (API, storage, graph, etc.)
- `icons/` - Extension icons
- `detect.json` - Web-accessible resource for detection
- `README.md` - Documentation
- `DEPLOY.md` - This file

## Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay one-time $5 developer fee (if not already)
3. Click "New Item" and upload the zip
4. Fill in store listing details
5. Submit for review (typically 1-3 days)

## Firefox Add-ons (AMO)

1. Go to https://addons.mozilla.org/developers/
2. Create account or log in
3. Click "Submit a New Add-on"
4. Choose distribution method:
   - **On this site** - Listed publicly on AMO
   - **On your own** - Self-distributed (signed but unlisted)
5. Upload the zip
6. Fill in listing details
7. Submit for review (typically 1-3 days)

### Firefox-Specific Notes

- The `browser_specific_settings.gecko.id` in manifest.json must be unique
- Minimum Firefox version is 128 (for MV3 + optional_host_permissions support)
- The extension declares `data_collection_permissions: { required: false }` (no user data collected)
- Firefox will review source code manually

## Local Testing

### Chrome
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the extension folder

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json`

Or use web-ext CLI:
```bash
npm install -g web-ext
web-ext run
```

## Version Bumping

Before each release, update the version in `manifest.json`:

```json
{
  "version": "0.1.1"
}
```

Both stores require version numbers to increase with each submission.
