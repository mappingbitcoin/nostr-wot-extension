# Changelog

All notable changes to this project will be documented in this file.

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
