# Nostr WOT Extension

[![Tests](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml/badge.svg)](https://github.com/nostr-wot/nostr-wot-extension/actions/workflows/tests.yml)

Query Nostr Web of Trust distance between pubkeys, manage your Nostr identity, and send zaps with a built-in Lightning wallet — all in one extension.

## What It Does

**Web of Trust** — Answers: **"How many hops separate me from this pubkey?"** and **"What's their trust score?"**

```javascript
// Any web app can call:
await window.nostr.wot.getDistance(targetPubkey)        // 2
await window.nostr.wot.getTrustScore(targetPubkey)      // 0.72
await window.nostr.wot.isInMyWoT(targetPubkey, 3)       // true
await window.nostr.wot.getDetails(targetPubkey)         // { hops: 2, paths: 5 }
await window.nostr.wot.getStatus()                      // { configured, mode, hasLocalGraph }
await window.nostr.wot.getConfig()                      // { maxHops, timeout, scoring }
```

Implements the [`window.nostr.wot` NIP proposal](https://github.com/nostr-protocol/nips/issues/2236) — Web of Trust Capability for Web Browsers.

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Remote** | Queries WoT Oracle API | Fast, no local storage |
| **Local** | Indexes your follow graph locally | Offline, privacy |
| **Hybrid** | Local first, fallback to remote | Best of both |

## Install

**Chrome Web Store:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)

**Firefox Add-ons:** [Install from Firefox Add-ons](https://addons.mozilla.org/addon/nostr-wot-extension/)

**Manual:**
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select folder

## Configuration

**First run:** The onboarding wizard guides you through account setup — generate new keys, import an nsec, add a watch-only npub, or connect a NIP-46 bunker.

**After setup:**
1. Click the extension icon to open the popup
2. Choose WoT mode (Remote/Local/Hybrid)
3. Customize scoring weights and relays (optional)
4. Sync your follow graph for local/hybrid mode

### Scoring Settings

Trust scores are computed locally using configurable weights:

```
score = baseScore * distanceWeight * (1 + pathBonus)
```

**Distance Weights** (default):

| Hops | Weight |
|------|--------|
| 1    | 1.0    |
| 2    | 0.5    |
| 3    | 0.25   |
| 4+   | 0.1    |

**Path Bonus per Level** (2+ hops):

| Hops | Bonus per path |
|------|----------------|
| 2    | 0.15 (+15%)    |
| 3    | 0.1 (+10%)     |
| 4+   | 0.05 (+5%)     |

*Note: No path bonus for 1 hop - direct follows are already maximum trust.*

- **Max Path Bonus**: 0.5 (capped at +50% total)
- Path count is computed in all modes (local, remote, hybrid)

### Advanced Options

- **Oracle URL**: WoT Oracle API endpoint (default: `https://wot-oracle.mappingbitcoin.com`)
- **Relays**: Nostr relays for local sync
- **Max Hops**: Maximum search depth (default: 3)
- **Timeout**: Request timeout in ms (default: 5000)

## Identity Management (Optional)

The extension includes an optional NIP-07 identity provider. You can use it as a standalone WoT tool, or also manage your Nostr keys.

### Account Types

| Type | Description | Signing |
|------|-------------|---------|
| **Generated** | New keys from a BIP-39 mnemonic (NIP-06 derivation) | Full |
| **Imported (nsec)** | Import an existing private key (nsec or hex) | Full |
| **Watch-only (npub)** | Load a public key for WoT queries only | None |
| **NIP-46 (Bunker)** | Remote signing via Nostr Connect (`bunker://` URL) | Remote |
| **External** | Delegates to another NIP-07 extension | Delegated |

### Key Security

- Private keys are encrypted at rest with **AES-256-GCM** (PBKDF2 with 210,000 iterations)
- Keys are only decrypted in memory when the vault is unlocked
- Auto-lock timer clears keys after 15 minutes of inactivity (configurable)
- Private key bytes are zeroed immediately after each signing operation
- Watch-only accounts never touch private key material

### NIP-07 Signer

When identity management is active, the extension exposes the standard `window.nostr` API:

```javascript
// Get public key
const pubkey = await window.nostr.getPublicKey();

// Sign an event
const signed = await window.nostr.signEvent(event);

// Encrypt/decrypt (NIP-04 legacy)
const ciphertext = await window.nostr.nip04.encrypt(theirPubkey, plaintext);
const plaintext = await window.nostr.nip04.decrypt(theirPubkey, ciphertext);

// Encrypt/decrypt (NIP-44 recommended)
const ciphertext = await window.nostr.nip44.encrypt(theirPubkey, plaintext);
const plaintext = await window.nostr.nip44.decrypt(theirPubkey, ciphertext);
```

Signing requests show a permission prompt. You can grant persistent permissions per-domain, per-method, or per-event-kind.

## Lightning Wallet & Zaps

The extension includes a built-in Lightning wallet for sending and receiving zaps on Nostr.

### Quick Setup

Click **Wallet > Quick Setup** to instantly provision a Lightning wallet via [zaps.nostr-wot.com](https://zaps.nostr-wot.com). No account registration required — the extension authenticates with your Nostr identity using a signed challenge.

### Manual Setup

You can also connect your own wallet:

| Method | Description |
|--------|-------------|
| **NWC** | Paste a `nostr+walletconnect://` URI from any NWC-compatible wallet |
| **LNbits** | Enter your LNbits instance URL and admin key |

### WebLN Provider

When a wallet is connected, the extension exposes the standard `window.webln` API:

```javascript
await window.webln.enable();
await window.webln.sendPayment(bolt11Invoice);
await window.webln.makeInvoice({ amount: 1000 });
const balance = await window.webln.getBalance();
```

Nostr clients that support WebLN (like Primal) can use this directly for zaps. Payment requests trigger a permission prompt — you can approve once or set an auto-approve threshold for small amounts.

### Lightning Address

After provisioning a wallet, claim a Lightning Address like `alice@zaps.nostr-wot.com` from the wallet settings. This creates an lnurlp pay link so others can send you payments. You can also add the address to your Nostr profile (`lud16`) with one click.

### NWC Connection

Provisioned wallets automatically receive an NWC connection URI. Copy it from the wallet UI to use in any NWC-compatible app.

## For Web Developers

Once installed, your app can query WoT:

```javascript
// Check if extension is available
if (window.nostr?.wot) {

  // Get distance from logged-in user to target
  const hops = await window.nostr.wot.getDistance(targetPubkey);

  if (hops === null) {
    console.log('Not connected');
  } else if (hops <= 2) {
    console.log('Close friend');
  } else {
    console.log(`${hops} hops away`);
  }

  // Get trust score (0-1)
  const score = await window.nostr.wot.getTrustScore(targetPubkey);
  console.log(`Trust score: ${score.toFixed(2)}`);

  // Boolean check with custom max hops
  const trusted = await window.nostr.wot.isInMyWoT(targetPubkey, 3);

  // Get detailed info (includes path count in remote mode)
  const details = await window.nostr.wot.getDetails(targetPubkey);
  console.log(`${details.hops} hops, ${details.paths} paths`);
}
```

## API Reference

### `window.nostr.wot.getDistance(targetPubkey)`
Returns hops from your pubkey to target, or `null` if not connected.

### `window.nostr.wot.getTrustScore(targetPubkey)`
Returns computed trust score (0-1) based on distance and configured weights.

### `window.nostr.wot.isInMyWoT(targetPubkey, maxHops?)`
Returns `true` if target is within `maxHops` of your pubkey. Uses configured maxHops if not specified.

### `window.nostr.wot.getDetails(targetPubkey)`
Returns `{ hops, paths }` with distance and path count.

### `window.nostr.wot.getStatus()`
Returns `{ configured, mode, hasLocalGraph }` — whether the extension is set up and operational.

### `window.nostr.wot.getConfig()`
Returns current configuration: `{ maxHops, timeout, scoring }`.

### `window.nostr.wot.getDistanceBatch(targets, options?)`
Returns distances for multiple targets in a single call. Options: `{ includePaths, includeScores }`.

### `window.nostr.wot.getTrustScoreBatch(targets)`
Returns trust scores for multiple targets in a single call.

### `window.nostr.wot.filterByWoT(pubkeys, maxHops?)`
Filters a list of pubkeys to only those within your Web of Trust.

### `window.nostr.wot.getFollows(pubkey)`
Returns the follow list for a pubkey from the local graph.

### `window.nostr.wot.getCommonFollows(pubkey)`
Returns pubkeys followed by both you and the target.

### `window.nostr.wot.getPath(targetPubkey)`
Returns an array of pubkeys representing the shortest path from you to the target. Requires user permission.

### `window.nostr.wot.getStats()`
Returns graph statistics (node count, edge count, etc.).

## Privacy

- **Remote mode:** Queries are sent to configured oracle
- **Local mode:** All data stays in your browser (IndexedDB)
- **No tracking, no analytics**

## Local Indexing

When using **Local** or **Hybrid** mode, the extension indexes your social graph directly from Nostr relays:

1. Configure your pubkey and relays in the popup
2. Select sync depth (1-3 hops)
3. Click "Sync Graph" to fetch your follow graph
4. Data is stored locally in IndexedDB

**Why local indexing?**
- **Privacy**: Your queries never leave your device
- **Speed**: Instant lookups once indexed
- **Offline**: Works without internet connection
- **Trust**: Don't rely on third-party oracles

**Hybrid mode** gives you the best of both:
- Local queries for pubkeys in your indexed graph
- Falls back to remote oracle for distant connections

## Default Relays

- wss://relay.damus.io
- wss://nos.lol
- wss://nostr-01.yakihonne.com

## Try It Out

Visit the [Nostr WoT Playground](https://nostr-wot.com/playground) to test the extension's API in your browser.

## Documentation

- [Architecture Reference](docs/architecture.md) - Technical deep dive into the extension's internals
- [Wallet & Lightning](docs/wallet.md) - Wallet providers, WebLN API, auto-provisioning, permissions
- [Adding Badge Support](docs/add_badge.md) - Guide for contributing badge adapters for new Nostr clients
- [Contributing](CONTRIBUTING.md) - How to contribute to the project
- [Security](SECURITY.md) - Security model and vulnerability reporting
- [Deployment](DEPLOY.md) - Building and publishing to browser stores
- [Changelog](CHANGELOG.md) - Version history

## Related

- [NIP proposal: `window.nostr.wot`](https://github.com/nostr-protocol/nips/issues/2236) - Web of Trust Capability for Web Browsers
- [nostr-wot-sdk](https://github.com/nostr-wot/nostr-wot-sdk) - JavaScript SDK
- [WoT Oracle](https://github.com/nostr-wot/nostr-wot-oracle) - Backend service
- [Nostr Wot website](https://nostr-wot.com) - Nostr Wot website

## License

MIT
