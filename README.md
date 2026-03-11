# Nostr WoT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

A browser extension for Nostr that manages your identity, signs events, sends zaps, and shows you who to trust — all without leaving your browser.

## Features

### Identity & Key Management

Create or import your Nostr identity and use it across any Nostr web client. The extension acts as a [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) signer — sites request access, you approve or deny.

| Account Type | Description |
|--------------|-------------|
| **Generate new keys** | BIP-39 mnemonic with NIP-06 derivation — back up your seed phrase |
| **Import nsec** | Bring your existing private key |
| **Watch-only (npub)** | View-only — no signing, just WoT queries |
| **NIP-46 Bunker** | Remote signing via `bunker://` URL |
| **External signer** | Delegate to another NIP-07 extension |

Signing requests show a permission prompt. Grant access once, per-domain, per-method, or per-event-kind.

### Encrypted Vault

Your private keys never leave the extension. They're encrypted at rest with **AES-256-GCM** (PBKDF2, 210,000 iterations) and only decrypted in memory when the vault is unlocked. An auto-lock timer clears everything after 15 minutes of inactivity (configurable, or set to "never"). Key bytes are zeroed immediately after each signing operation.

### Lightning Wallet & Zaps

Send and receive Lightning payments directly from the extension.

**Quick Setup** — One click provisions a Lightning wallet via [zaps.nostr-wot.com](https://zaps.nostr-wot.com). No registration — the extension authenticates with your Nostr identity.

**Manual Setup** — Connect your own wallet with a `nostr+walletconnect://` URI (NWC) or an LNbits instance URL + admin key.

Once connected:
- View your balance and transaction history
- Generate deposit invoices with QR codes
- Send payments by pasting a BOLT11 invoice
- Claim a Lightning Address like `you@zaps.nostr-wot.com`
- Copy your NWC connection URI to use in other apps
- Set an auto-approve threshold for small zaps

The extension exposes a standard [WebLN](https://www.webln.dev/) provider (`window.webln`), so Nostr clients that support zaps (like Primal) work out of the box.

### Multi-Account Support

Switch between multiple identities. Each account gets its own isolated database, permissions, wallet, and WoT graph. Switching accounts is instant.

### Per-Site Controls

- Allow or block sites from accessing your identity
- Disable identity on specific sites while keeping WoT active
- Manage signing permissions per domain

---

## Web of Trust

On top of the core identity and wallet features, the extension provides a Web of Trust layer that answers: **"How close is this person to me in my social graph?"**

### How It Works

The extension maps your Nostr follow graph and computes the shortest path between you and any pubkey. A direct follow is 1 hop, a follow-of-follow is 2 hops, and so on.

### Trust Badges

When you browse Nostr web clients, the extension injects visual badges showing the WoT distance for each profile you see. Built-in support for Primal, Snort, Nostrudel, Coracle, Iris, and a generic fallback. Badge appearance and behavior are customizable per-site.

### WoT Modes

| Mode | Description |
|------|-------------|
| **Remote** | Queries a WoT Oracle API — fast, no local storage |
| **Local** | Indexes your follow graph in the browser (IndexedDB) — private, works offline |
| **Hybrid** | Local first, falls back to remote for distant connections |

### Trust Scoring

Trust scores (0–1) combine hop distance with path diversity:

```
score = baseScore * distanceWeight * (1 + pathBonus)
```

Distance weights and path bonuses are configurable. Defaults give direct follows a score of 1.0, 2-hop connections 0.5, and 3-hop connections 0.25.

### WoT API for Web Developers

The extension exposes `window.nostr.wot` for any web app to query, implementing the [`window.nostr.wot` NIP proposal](https://github.com/nostr-protocol/nips/issues/2236).

```javascript
if (window.nostr?.wot) {
  const hops = await window.nostr.wot.getDistance(targetPubkey);     // 2
  const score = await window.nostr.wot.getTrustScore(targetPubkey);  // 0.72
  const inWoT = await window.nostr.wot.isInMyWoT(targetPubkey, 3);  // true
  const details = await window.nostr.wot.getDetails(targetPubkey);   // { hops: 2, paths: 5, score: 0.72 }
}
```

**Full API:**

| Method | Returns |
|--------|---------|
| `getDistance(pubkey)` | Hop count or `null` |
| `getTrustScore(pubkey)` | Score 0–1 or `null` |
| `isInMyWoT(pubkey, maxHops?)` | `boolean` |
| `getDetails(pubkey)` | `{ hops, paths, score }` |
| `getDistanceBatch(pubkeys, options?)` | Bulk distances with optional paths/scores |
| `getTrustScoreBatch(pubkeys)` | Bulk trust scores |
| `filterByWoT(pubkeys, maxHops?)` | Filtered array of in-WoT pubkeys |
| `getFollows(pubkey)` | Follow list from the local graph |
| `getCommonFollows(pubkey)` | Mutual follows between you and target |
| `getPath(pubkey)` | Shortest path as pubkey array |
| `getStats()` | Graph stats (nodes, edges, etc.) |
| `getStatus()` | `{ configured, mode, hasLocalGraph }` |
| `getConfig()` | `{ maxHops, timeout, scoring }` |

---

## Install

**Chrome Web Store:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)

**Firefox Add-ons:** [Install from Firefox Add-ons](https://addons.mozilla.org/addon/nostr-wot-extension/)

**Manual:**
1. Clone this repo
2. `npm install && npm run build`
3. Go to `chrome://extensions`, enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` folder

## Getting Started

1. Install the extension and follow the onboarding wizard to set up your account
2. Click the extension icon to manage identity, wallet, and WoT settings
3. Visit any Nostr web client — the extension handles signing and displays trust badges automatically

## Privacy

- **Local mode:** All WoT data stays in your browser (IndexedDB)
- **Remote mode:** WoT queries go to the configured oracle only
- **No tracking, no analytics, no telemetry**

## Try It Out

Visit the [Nostr WoT Playground](https://nostr-wot.com/playground) to test the extension's WoT API in your browser.

## Documentation

- [Architecture Reference](docs/architecture.md) — Technical deep dive into the extension's internals
- [Wallet & Lightning](docs/wallet.md) — Wallet providers, WebLN API, auto-provisioning, permissions
- [Adding Badge Support](docs/add_badge.md) — Guide for contributing badge adapters for new Nostr clients
- [Contributing](CONTRIBUTING.md) — How to contribute to the project
- [Security](SECURITY.md) — Security model and vulnerability reporting
- [Deployment](DEPLOY.md) — Building and publishing to browser stores
- [Changelog](CHANGELOG.md) — Version history

## Related

- [NIP proposal: `window.nostr.wot`](https://github.com/nostr-protocol/nips/issues/2236) — Web of Trust Capability for Web Browsers
- [nostr-wot-sdk](https://github.com/nostr-wot/nostr-wot-sdk) — JavaScript SDK
- [WoT Oracle](https://github.com/nostr-wot/nostr-wot-oracle) — Backend service
- [Nostr WoT website](https://nostr-wot.com)

## License

MIT
