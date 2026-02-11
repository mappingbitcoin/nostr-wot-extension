# Nostr WOT Extension

Query Nostr Web of Trust distance between pubkeys. Know how many hops separate you from anyone on Nostr.

## What It Does

Answers: **"How many hops separate me from this pubkey?"** and **"What's their trust score?"**

```javascript
// Any web app can call:
await window.nostr.wot.getDistance(targetPubkey)        // 2
await window.nostr.wot.getTrustScore(targetPubkey)      // 0.72
await window.nostr.wot.isInMyWoT(targetPubkey, 3)       // true
await window.nostr.wot.getDistanceBetween(pubA, pubB)   // 3
await window.nostr.wot.getDetails(targetPubkey)         // { hops: 2, paths: 5 }
await window.nostr.wot.getConfig()                      // { maxHops, timeout, scoring }
```

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Remote** | Queries WoT Oracle API | Fast, no local storage |
| **Local** | Indexes your follow graph locally | Offline, privacy |
| **Hybrid** | Local first, fallback to remote | Best of both |

## Install

**Chrome Web Store:** [Install from Chrome Web Store](https://chromewebstore.google.com/detail/nostr-wot-extension/gfmefgdkmjpjinecjchlangpamhclhdo)

**Manual:**
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select folder

## Configuration

1. Click extension icon
2. Your pubkey is auto-detected from NIP-07 signer (Alby, nos2x, etc.) if available
3. Or enter your pubkey manually (hex format)
4. Choose mode (Remote/Local/Hybrid)
5. Customize scoring weights (optional)
6. Click "Save Settings"

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

### `window.nostr.wot.getDistanceBetween(fromPubkey, toPubkey)`
Returns hops between any two pubkeys.

### `window.nostr.wot.getDetails(targetPubkey)`
Returns `{ hops, paths }` with distance and path count (paths available in remote mode only).

### `window.nostr.wot.getConfig()`
Returns current configuration: `{ maxHops, timeout, scoring }`.

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
- wss://relay.nostr.band
- wss://relay.mappingbitcoin.com

## Try It Out

Visit the [Nostr WoT Playground](https://nostr-wot.com/playground) to test the extension's API in your browser.

## Related

- [nostr-wot-sdk](https://github.com/mappingbitcoin/nostr-wot-sdk) - JavaScript SDK
- [WoT Oracle](https://github.com/mappingbitcoin/wot-oracle) - Backend service
- [Nostr Wot website](https://nostr-wot.com) - Nostr Wot website

## License

MIT
