# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-03-08

### Added
- **Lightning Wallet (WebLN)** — built-in Lightning wallet support with WebLN provider (`window.webln`) for sending and receiving zaps directly from Nostr clients
- **Quick Wallet Setup** — one-click wallet provisioning via zaps.nostr-wot.com with challenge-response authentication; no account registration needed
- **LNbits manual connect** — connect your own LNbits instance with admin key
- **NWC connect** — connect any Nostr Wallet Connect compatible wallet
- **NWC auto-provisioning** — provisioned wallets automatically get an NWC connection URI for use in other apps
- **Wallet UI** — balance display, deposit invoices with QR codes, auto-approve threshold for zaps
- **WebLN permission system** — per-domain approval for `sendPayment` with remember option
- **Payment approval overlay** — pending zap requests shown in popup with approve/deny actions

### Changed
- **WebLN `enable()` always succeeds** — apps that call `enable()` on page load (like Primal) no longer get permanently locked out when the vault is locked
- **Version moved to single source of truth** — extension version is read from the manifest at runtime instead of being duplicated across locale files

### Fixed
- **WebLN payment approval was invisible** — `webln_sendPayment` requests were missing `needsPermission: true`, making them appear in the badge count but not in the approval overlay
- Removed stale debug `console.log` statements from NIP-07 and WebLN handlers

## [0.2.0] - 2025-02-24

### Added
- **NIP-07 Identity Provider** — full `window.nostr` signer (getPublicKey, signEvent, getRelays, nip04, nip44)
- **Encrypted Key Vault** — AES-256-GCM with PBKDF2 (210,000 iterations), auto-lock timer
- **Multi-account support** — generated (BIP-39/NIP-06), imported nsec, watch-only npub, NIP-46 bunker, external signer
- **Per-account IndexedDB** — each identity gets its own `nostr-wot-{accountId}` database
- **Onboarding wizard** — first-run setup flow for account creation and import
- **Signing prompt system** — popup window for approving/denying NIP-07 requests with remember option
- **Permission system** — per-domain, per-method, per-event-kind permission storage and cascade
- **NIP-46 Nostr Connect** — remote signing via bunker:// URLs
- **WoT trust badges** — visual hop-distance badges injected into Nostr web clients (Primal, Snort, Nostrudel, Coracle, Iris, generic fallback)
- **Activity logging** — tracks signing operations per domain (capped at 200 entries)
- **Pure JS crypto library** — secp256k1, Schnorr (BIP-340), NIP-01, NIP-04, NIP-44, BIP-32, BIP-39, bech32
- **Internationalization** — i18n support with English and Spanish locales
- **Test suite** — node:test based tests for crypto, vault, signer, permissions, accounts
- **CI pipeline** — GitHub Actions workflow for automated testing
- **CONTRIBUTING.md** — contributor guide with project structure and guidelines
- **docs/architecture.md** — full technical architecture reference
- **docs/add_badge.md** — guide for adding badge support to new Nostr clients
- **SECURITY.md** — security model documentation

### Changed
- **API: `isConfigured()` → `getStatus()`** — returns `{ configured, mode, hasLocalGraph }` instead of a boolean
- **API: removed `getDistanceBetween()`** — third-party distance queries removed for privacy (surveillance vector)
- Precomputed BFS cache with O(1) lookups via typed arrays (Uint8Array hops, Uint32Array paths)
- Delta-encoded follow storage format (sorted Uint32Array deltas)
- Background rate limiter: 10 req/sec per method (sliding window)
- Privileged method gating via sender ID verification
- Version bump to 0.2.0

### Fixed
- Sync crash when triggered without a valid pubkey
- Graph syncing reliability improvements

## [0.1.1] - 2025-02-17

### Added
- Firefox support (requires Firefox 128+)
- Cross-browser compatibility layer (`browser.*` API)
- npub format support for pubkey input (in addition to hex)
- `DEPLOY.md` with deployment instructions for Chrome and Firefox stores
- `data_collection_permissions` declaration for Firefox

### Changed
- Replaced unsafe `innerHTML` usage with safe DOM methods
- Updated minimum Firefox version to 128.0 for full MV3 support
- Improved pubkey validation to accept both hex and npub formats

### Fixed
- Firefox extension URL detection (added `moz-extension://` support)

## [0.1.0] - 2025-02-15

### Added
- Initial release
- Chrome Web Store publication
- Web of Trust distance queries
- Local graph sync from Nostr relays
- Remote oracle support
- Trust score calculation
- Per-domain permission system
- `window.nostr.wot` API for web pages
