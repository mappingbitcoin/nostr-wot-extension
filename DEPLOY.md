# Deployment Guide

This extension is compatible with both Chrome and Firefox.

## Building

```bash
npm run build        # Build to dist/
npm run typecheck    # Verify TypeScript (no emit)
npm run test         # Run full test suite
```

## Packaging for Stores

Each command builds the extension and creates a store-ready zip:

```bash
npm run package:chrome    # → nostr-wot-chrome.zip
npm run package:firefox   # → nostr-wot-firefox.zip
```

### What each script does

| Step | Chrome | Firefox |
|------|--------|---------|
| Build | `vite build` | `vite build` |
| Compile badge engine | TS → JS (Vite plugin) | TS → JS (Vite plugin) |
| Manifest patch | Strips `browser_specific_settings` | Adds `background.scripts` |
| Zip | `dist/` excluding `.vite/` | `dist/` excluding `.vite/` |

### Chrome-specific manifest

- `browser_specific_settings` is removed (Firefox-only key, Chrome logs a console warning if present)
- Uses `background.service_worker` for the background script

### Firefox-specific manifest

- `browser_specific_settings.gecko` is kept (required for AMO: extension id, min version)
- `background.scripts` is added alongside `service_worker` (Firefox 128-129 needs `scripts`; 130+ supports both)

## Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole
2. Pay one-time $5 developer fee (if not already)
3. Click "New Item" and upload `nostr-wot-chrome.zip`
4. Fill in store listing details
5. Submit for review (typically 1-3 days)

## Firefox Add-ons (AMO)

1. Go to https://addons.mozilla.org/developers/
2. Create account or log in
3. Click "Submit a New Add-on"
4. Choose distribution method:
   - **On this site** — Listed publicly on AMO
   - **On your own** — Self-distributed (signed but unlisted)
5. Upload `nostr-wot-firefox.zip`
6. AMO requires source code for review — upload a zip of the repo or link to the GitHub repo
7. Fill in listing details
8. Submit for review (typically 1-3 days)

### Firefox-specific notes

- The `browser_specific_settings.gecko.id` in manifest.json must be unique
- Minimum Firefox version is 128 (for MV3 + `optional_host_permissions` support)
- `data_collection_permissions: { required: ["none"] }` — no user data collected
- Firefox will review source code manually

## Local Testing

### Chrome

1. `npm run build`
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` folder

### Firefox

1. `npm run build`
2. Go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select `dist/manifest.json`

Or use web-ext CLI:
```bash
npm install -g web-ext
web-ext run -s dist
```

## Version Bumping

Before each release, update the version in both files:

- `manifest.json` → `"version": "x.y.z"`
- `package.json` → `"version": "x.y.z"`

Both stores require version numbers to increase with each submission.
