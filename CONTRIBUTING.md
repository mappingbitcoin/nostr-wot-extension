# Contributing to Nostr WoT Extension

Thank you for your interest in contributing! This extension provides NIP-07 signing, Web of Trust distance checking, and trust score badge injection for Nostr web clients.

## Getting Started

### Prerequisites

- Node.js 18+ (for running tests)
- Chrome or Firefox browser
- Basic familiarity with browser extension development (MV3)

### Setup

```bash
git clone https://github.com/user/nostr-wot-extension.git
cd nostr-wot-extension
```

No build step required — the extension uses plain ES modules with no bundler.

### Loading the Extension

**Chrome:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project directory

**Firefox:**
1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in the project directory (e.g., `manifest.json`)

### Running Tests

```bash
node --test tests/
```

Tests use Node.js native `node:test` module with browser API mocks in `tests/helpers/`.

## Project Structure

```
├── background.js          # Service worker — all business logic
├── content.js             # Content script (ISOLATED world) — message bridge
├── inject.js              # Page script (MAIN world) — window.nostr API
├── badges/
│   ├── engine.js          # Badge injection engine (MAIN world)
│   ├── badges.css         # Badge visual styles
│   └── adapters/          # Per-site badge adapters
│       ├── primal.js
│       ├── snort.js
│       ├── nostrudel.js
│       ├── coracle.js
│       ├── iris.js
│       └── generic.js     # Fallback for any site with npub links
├── lib/
│   ├── crypto/            # Pure JS crypto (secp256k1, schnorr, NIPs)
│   ├── storage.js         # IndexedDB per-account graph storage
│   ├── sync.js            # BFS graph sync from relays
│   ├── graph.js           # Precomputed BFS with typed array cache
│   ├── scoring.js         # Trust score calculation
│   ├── vault.js           # AES-256-GCM encrypted key vault
│   ├── signer.js          # NIP-07 signing coordinator
│   ├── permissions.js     # Per-site permission storage
│   ├── accounts.js        # Account creation/import
│   ├── nip46.js           # NIP-46 Nostr Connect client
│   └── browser.js         # Cross-browser compatibility shim
├── popup/                 # Extension popup (tab-based UI)
├── onboarding/            # First-run setup wizard
├── prompt/                # Signing request approval popup
├── docs/
│   ├── architecture.md    # Technical architecture reference
│   └── add_badge.md       # Guide for adding badge support
└── tests/                 # Node.js test suite
```

## Types of Contributions

### Adding Badge Support for a New Nostr Client

This is the easiest way to contribute. See [docs/add_badge.md](docs/add_badge.md) for the full guide.

**Quick version:**
1. Inspect the target site's DOM structure
2. Add a site adapter to `wot-badges.js`
3. Test on the actual site
4. Submit a PR with screenshots

### Bug Fixes

1. Check existing issues first
2. Create a failing test case if possible
3. Fix the bug
4. Verify existing tests still pass: `node --test tests/`

### New Features

1. Open an issue to discuss the feature first
2. Reference the relevant NIP if applicable
3. Follow existing patterns in the codebase
4. Add tests for new backend logic

## Pull Request Process

### 1. Fork and Branch

```bash
git checkout -b feature/my-change
```

Use these branch name prefixes:
- `feature/` — new functionality
- `fix/` — bug fixes
- `badge/` — new site badge support
- `docs/` — documentation

### 2. Make Changes

- Follow existing code style (no linter configured — match surrounding code)
- Use plain ES modules, no build tools
- Use optional chaining (`?.`) for DOM access
- Zero private keys after use (`privkey.fill(0)` in `try/finally`)
- Gate privileged message handlers via `PRIVILEGED_METHODS` Set
- No external dependencies — the extension is self-contained

### 3. Test

```bash
node --test tests/
```

For UI changes, manually test in Chrome and Firefox:
- Open the popup and verify all tabs work
- Test dark mode (system preference)
- Test with 0 accounts, 1 account, and multiple accounts
- Test with both signing accounts and read-only accounts

### 4. Submit

- Write a clear PR title (e.g., "badge: add support for habla.news")
- Describe what changed and why
- Include screenshots for UI changes
- Reference any related issues

## Architecture Notes

Read [docs/architecture.md](docs/architecture.md) for the full technical reference. Key points:

- **No build system** — files are loaded directly by the browser
- **Message passing** — inject.js → content.js → background.js via `postMessage` and `runtime.sendMessage`
- **Privileged methods** — vault, permission, and management operations are gated to internal extension pages via sender ID verification
- **Per-account databases** — each account gets its own IndexedDB named `nostr-wot-{accountId}`
- **Precomputed graph** — distances are cached in typed arrays for O(1) lookup after first query

## Security Guidelines

- Never log or expose private keys
- Always zero `Uint8Array` private keys after use
- Validate all inputs from web pages (content script allowlists)
- Use `sender.id` checks for privileged operations
- Rate-limit external-facing API methods
- Verify event signatures before trusting relay data

## Code of Conduct

Be respectful, constructive, and focused on building great software. Technical disagreements are welcome; personal attacks are not.
