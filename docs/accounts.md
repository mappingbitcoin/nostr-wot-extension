# Account System

## 1. Registry

Accounts are stored in two locations:

| Storage | Key | Contents |
|---------|-----|----------|
| `browser.storage.local` | `accounts` | Array of `{ id, name, pubkey, type, readOnly }` -- public metadata, always accessible |
| `browser.storage.local` | `keyVault` | Encrypted vault containing full account objects (with `privkey`, `mnemonic`) |
| `browser.storage.local` | `activeAccountId` | Currently selected account ID |

The local `accounts` array enables UI rendering even when the vault is locked. The vault holds the authoritative account data including secrets.

---

## 2. Account Types

| Type | Source | Can Sign | Vault Entry |
|------|--------|----------|-------------|
| `generated` | BIP-39 mnemonic via NIP-06 (`m/44'/1237'/0'/0/0`) | Yes | privkey + mnemonic |
| `nsec` | Imported nsec or hex private key | Yes | privkey |
| `npub` | Imported npub or hex public key | No | pubkey only |
| `nip46` | NIP-46 bunker URL (remote signer) | Yes (remote) | nip46Config |
| `external` | Another NIP-07 extension | Yes (delegated) | pubkey only |

---

## 3. Account ID Generation

Account IDs are generated as 12-character random hex strings:

```js
const arr = crypto.getRandomValues(new Uint8Array(6));
return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
```

---

## 4. Per-Account Database

Each account gets its own IndexedDB instance named `nostr-wot-{accountId}`. This isolates each identity's social graph data. See [Storage](storage.md) for full schema details.

---

## 5. Account Switching

When the active account changes (`switchAccount` handler in `background.ts`):

1. `stopSync()` -- stop current sync if in progress
2. `vault.setActiveAccount(accountId)` -- update vault's active account pointer (or `clearActiveAccount()` for read-only accounts not in vault)
3. Update `browser.storage.sync.myPubkey` -- canonical pubkey source for signer
4. Update `browser.storage.local.activeAccountId`
5. `storage.switchDatabase(accountId)` -- flush, close, open new DB, reload caches
6. `localGraph = new LocalGraph()` -- invalidate graph cache
7. **`signer.rejectPendingForAccount(oldAccountId)`** -- reject all pending signing requests for the old account to prevent signing with the wrong key
8. `broadcastAccountChanged(pubkey)` -- notify all tabs about the change

---

## 6. Read-Only Account Behavior

For accounts without private keys (`npub`, some `external`), the `vault_getActiveAccountType` handler tries the vault first, then falls back to the local `accounts` array -- enabling type detection even without an unlocked vault.
