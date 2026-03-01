# Configuration

## 1. Mode System

The extension supports three operational modes for graph queries, stored in `browser.storage.sync.mode`:

| Mode | Behavior |
|------|----------|
| `hybrid` (default) | Local graph consulted first; falls back to the remote oracle API for pubkeys beyond sync depth |
| `local` | Only local graph, no network queries. Returns `null` for unknown pubkeys. |
| `remote` | Only oracle API. Legacy mode, not recommended when local data exists. |

The remote oracle is at `https://wot-oracle.mappingbitcoin.com` by default (`lib/api.ts`). It exposes REST endpoints for `/distance`, `/distance/batch`, `/follows`, `/common-follows`, `/path`, `/stats`, and `/health`.

---

## 2. Default Configuration

```js
{
    mode: 'hybrid',
    oracleUrl: 'https://wot-oracle.mappingbitcoin.com',
    myPubkey: null,
    relays: [
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band',
        'wss://relay.mappingbitcoin.com'
    ],
    maxHops: 3,
    timeout: 5000,
    scoring: DEFAULT_SCORING
}
```

Configuration is loaded from `browser.storage.sync` on startup and whenever `configUpdated` is called. Relays are stored as a comma-separated string in sync storage and parsed on load.

---

## 3. Profile Metadata Caching

Kind:0 (profile metadata) events are fetched from relays and cached at two levels:

| Level | TTL | Storage |
|-------|-----|---------|
| In-memory | 30 minutes | `profileCache: Map<pubkey, { metadata, fetchedAt }>` |
| Persistent | 30 minutes | `browser.storage.local` under `profile_{pubkey}` |

The fetch queries all configured relays simultaneously, accepts the newest event (highest `created_at`), with a 5-second overall timeout and 4-second per-relay timeout.
