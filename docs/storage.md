# Storage Layer -- `lib/storage.ts`

## 1. Database Naming

- Per-account: `nostr-wot-{accountId}` (e.g., `nostr-wot-m7k3a9x2bc`)
- Legacy (pre-multi-account): `nostr-wot`

On startup, `migrateGlobalDatabase(accountId)` migrates data from the legacy `nostr-wot` database to the active account's per-account database, then deletes the legacy DB.

---

## 2. Schema

IndexedDB version 2 with three object stores:

| Store | Key | Schema | Index |
|-------|-----|--------|-------|
| `pubkeys` | `id` (auto-increment integer) | `{ id: number, pubkey: string }` | `pubkey` (unique) |
| `follows_v2` | `id` (integer, matching pubkey ID) | `{ id: number, follows: ArrayBuffer, updated_at: number }` | -- |
| `meta` | `key` (string) | `{ key: string, value: any }` | -- |

The v1 `follows` store (if present) is deleted during upgrade.

---

## 3. Pubkey ID Mapping

String pubkeys (64-char hex) are mapped to sequential integer IDs for memory efficiency:

- `pubkeyToId: Map<string, number>` -- forward lookup
- `idToPubkey: Map<number, string>` -- reverse lookup
- `nextId: number` -- monotonically increasing counter

All mappings are loaded into memory on `initDB()`. New IDs are assigned synchronously via `getOrCreateId(pubkey)` and batched for disk persistence.

---

## 4. Follow Storage Format

Follows are stored as **delta-encoded sorted Uint32Arrays**:

```
Encoding:
  sorted = sort(followIds)
  deltas[0] = sorted[0]           // absolute first value
  deltas[i] = sorted[i] - sorted[i-1]  // delta from previous

Stored as: Uint32Array.buffer (ArrayBuffer)
```

This achieves compact storage since deltas between sorted sequential IDs are small numbers.

---

## 5. In-Memory Graph Cache

```
graphCache: Map<id, Uint32Array>
```

The entire follow graph is loaded into memory on `initDB()` via `loadGraphCache()`. All graph traversal operates on this in-memory cache, making lookups synchronous. The `getFollowIdsSync(id)` function returns the `Uint32Array` directly from the map.

---

## 6. Write Buffering

Two independent write buffers batch IndexedDB writes:

| Buffer | Target Store | Size Threshold | Timer Interval |
|--------|-------------|----------------|----------------|
| `writeBuffer` (follows) | `follows_v2` | 100 entries | 100ms |
| `pubkeyWriteBuffer` (pubkey IDs) | `pubkeys` | 500 entries | 50ms |

Writes go to memory immediately (cache is always current), and are flushed to disk either when the buffer reaches its size threshold or when the timer fires. The pubkey buffer is flushed before the follows buffer to ensure ID mappings exist before follow records reference them.

---

## 7. Database Switching

When the active account changes:

1. `flushWriteBuffer()` -- persist all pending writes
2. `resetCaches()` -- clear all in-memory Maps, buffers, timers
3. `db.close()` -- close the IndexedDB connection
4. `initDB(newAccountId)` -- open the new account's database
5. `loadPubkeyCache()` + `loadGraphCache()` -- reload caches from new DB

---

## 8. Firefox Compatibility

`indexedDB.databases()` is Chrome-only. When listing databases on Firefox, the code falls back to:
- Returning the currently open database
- Probing for the legacy `nostr-wot` database by attempting to open it and checking if it contains data

---

## 9. Wallet Storage

### 9.1 Wallet Configuration (Encrypted)

Wallet credentials are stored as `walletConfig` inside the `Account` object, which is encrypted inside the vault (`keyVault` in `browser.storage.local`). This means wallet configs are protected by the same AES-256-GCM + PBKDF2 encryption as private keys and mnemonics.

```ts
// Part of Account in lib/types.ts
walletConfig?: WalletConfig;

// WalletConfig is a discriminated union:
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string };
```

### 9.2 Auto-Approve Threshold (`browser.storage.local`)

| Key | Value | Purpose |
|-----|-------|---------|
| `walletThreshold_{accountId}` | `number` (sats) | Per-account payment auto-approve threshold. Payments at or below this amount skip the approval prompt. Default: `0` (all payments require approval). |

Managed by privileged methods `wallet_setAutoApproveThreshold` and `wallet_getAutoApproveThreshold`.

