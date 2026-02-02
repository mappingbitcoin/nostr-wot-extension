# Nostr WOT Extension

Query Nostr Web of Trust distance between pubkeys. Know how many hops separate you from anyone on Nostr.

## What It Does

Answers: **"How many hops separate me from this pubkey?"**
```javascript
// Any web app can call:
await window.nostr.wot.getDistance(targetPubkey)        // → 2
await window.nostr.wot.isInMyWoT(targetPubkey, 3)       // → true
await window.nostr.wot.getDistanceBetween(pubA, pubB)   // → 3
```

## Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Remote** | Queries WoT Oracle API | Fast, no local storage |
| **Local** | Indexes your follow graph locally | Offline, privacy |
| **Hybrid** | Local first, fallback to remote | Best of both |

## Install

**Chrome Web Store:** (coming soon)

**Manual:**
1. Clone this repo
2. Go to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" → select folder

## Configuration

1. Click extension icon
2. Set your pubkey (hex)
3. Choose mode
4. Set oracle URL (default: `https://wot-oracle.mappingbitcoin.com`)

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

  // Boolean check
  const trusted = await window.nostr.wot.isInMyWoT(targetPubkey, 3);
}
```

## API Reference

### `window.nostr.wot.getDistance(targetPubkey)`
Returns hops from your pubkey to target, or `null` if not connected.

### `window.nostr.wot.isInMyWoT(targetPubkey, maxHops = 3)`
Returns `true` if target is within `maxHops` of your pubkey.

### `window.nostr.wot.getDistanceBetween(fromPubkey, toPubkey)`
Returns hops between any two pubkeys.

## Privacy

- **Remote mode:** Queries are sent to configured oracle
- **Local mode:** All data stays in your browser (IndexedDB)
- **No tracking, no analytics**

## Related

- [WoT Oracle](https://github.com/mappingbitcoin/wot-oracle) - Backend service
- [NIP-90](https://github.com/nostr-protocol/nips/blob/master/90.md) - DVM protocol

## Local Indexing

When using **Local** or **Hybrid** mode, the extension can index your social graph directly from Nostr relays:

1. Configure your pubkey and relays in the popup
2. Click "Sync Local Graph (2 hops)" to fetch your follow graph
3. The extension fetches Kind 3 (contact list) events from relays
4. Data is stored locally in IndexedDB - nothing leaves your browser

**Why local indexing?**
- **Privacy**: Your queries never leave your device for your own WoT
- **Speed**: Instant lookups once indexed
- **Offline**: Works without internet connection
- **Trust**: Don't trust a third party oracle for your direct connections

**Hybrid mode** gives you the best of both worlds:
- Local queries for pubkeys in your indexed graph (up to 2 hops)
- Falls back to remote oracle for distant connections

## License

MIT
