# Syncing -- `lib/sync.ts`

## 1. BFS Crawl

`GraphSync.syncFromPubkey(rootPubkey, maxDepth)` performs a breadth-first crawl of the Nostr social graph starting from the user's pubkey, fetching kind:3 (contact list) events.

---

## 2. Root vs. Non-Root Fetching

| Target | Strategy | Rationale |
|--------|----------|-----------|
| Root pubkey | Queried from **ALL** connected relays simultaneously; newest event (highest `created_at`) selected | Ensures the user's own contact list is complete and up-to-date |
| Non-root pubkeys | Queried from **one** relay (best available); falls back to others on failure | Balances speed with relay courtesy |

---

## 3. Relay Management

Each relay is wrapped in a `RelayConnection` instance with:

- **Adaptive delay**: Starts at `BASE_DELAY = 50ms` between requests. On error, multiplied by 1.5 (up to `MAX_DELAY = 2000ms`). On every 10th consecutive success, multiplied by 0.8 (down to `BASE_DELAY`).
- **Concurrency limit**: `CONCURRENT_PER_RELAY = 5` in-flight requests per relay.
- **Connection timeout**: 5000ms to establish WebSocket.
- **Request timeout**: 10000ms per individual fetch.

---

## 4. Relay Selection

`getBestRelay()` selects the relay with the fewest in-flight requests, breaking ties by lowest delay:

```js
ready.sort((a, b) => {
    if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
    return a.delay - b.delay;
});
```

---

## 5. Batching

Pubkeys are fetched in batches of `BATCH_SIZE = 50`, distributed across relays via `fetchBatch()`. Each pubkey in the batch is fetched concurrently, with the relay selected per-pubkey by `getBestRelay()`.

---

## 6. Deduplication

A `queued: Set<string>` tracks every pubkey that has been scheduled for fetching, preventing any pubkey from being fetched or enqueued twice.

---

## 7. Abort

`stopSync()` sets the abort flag, closes all WebSocket connections, flushes the write buffer, and returns a Promise that resolves when the sync loop has fully terminated. Callers waiting on `stopSync()` are collected in `syncDoneResolvers[]` and notified in the `finally` block.

---

## 8. Progress Reporting

Progress callbacks are rate-limited to `PROGRESS_INTERVAL = 200ms` and broadcast to the popup via `browser.runtime.sendMessage({ type: 'syncProgress', progress })`.

---

## 9. Service Worker Restart Recovery

On `loadConfig()`, the background script checks for stale `syncState` meta (from interrupted syncs due to service worker termination) and resets `inProgress` to `false`.
