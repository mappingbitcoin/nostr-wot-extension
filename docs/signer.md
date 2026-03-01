# NIP-07 Signer -- `lib/signer.ts`

## 1. Signing Flow

The signer checks **permissions FIRST**, then vault lock state. This means a denied permission is enforced even when the vault is unlocked and the key is available.

```
Web page calls window.nostr.signEvent(event)
    |
inject.ts  -->  NIP07_REQUEST { method: 'signEvent', params: { event } }
    |
content.ts -->  { method: 'nip07_signEvent', params: { event, origin: hostname } }
    |
background.ts  -->  signer.handleSignEvent(event, origin)
    |
    v
[1] Get active account info from storage (accountId, accountType)
[2] Check vault.exists() -- throw if no vault (and not nip46)
[3] permissions.check(origin, 'signEvent', event.kind, accountId)
    - 'deny' --> throw "Permission denied" (STOPS HERE)
    - 'ask' --> queue for popup approval (badge shown)
    - 'allow' --> proceed
[4] If type === 'nip46' --> route to remote signer (NIP-46)
[5] If vault.isLocked() --> queue as waitingForUnlock
[6] If still locked after queue resolves --> throw "Vault is locked"
[7] vault.getPrivkey() --> sign with cryptoSignEvent --> privkey.fill(0)
[8] Return signed event
```

---

## 2. Permissions x Lock State Matrix

The interaction between permissions and vault state:

| Permission | Vault    | getPublicKey | signEvent / encrypt / decrypt |
|------------|----------|--------------|-------------------------------|
| `deny`     | locked   | REJECTED     | REJECTED                      |
| `deny`     | unlocked | REJECTED     | REJECTED                      |
| `allow`    | locked   | WORKS *      | BLOCKED (queues waitingForUnlock) |
| `allow`    | unlocked | WORKS        | WORKS                         |
| `ask`      | locked   | QUEUED       | QUEUED                        |
| `ask`      | unlocked | QUEUED       | QUEUED                        |

\* `getPublicKey` reads from `browser.storage.sync.myPubkey`, not from the vault

---

## 3. Prompt System (In-Popup Approval)

- Pending requests stored in `browser.storage.session` under key `signerPending` as an array.
- Popup overlay shows pending requests with approve/deny buttons.
- **Storage mutex**: `withStorageLock()` prevents concurrent read-modify-write races on session storage.
- **Request timeout**: 120 seconds. Unresolved requests are auto-rejected.
- **Badge count**: Shows number of pending requests needing user action.
- Users can choose "remember" to save the permission decision, optionally scoped to a specific event kind.
- **Batch resolve**: `resolveBatch()` resolves all pending requests for the same origin + method + kind.

---

## 4. Account Switching

When the active account changes:
1. `signer.rejectPendingForAccount(oldAccountId)` -- rejects all pending requests for the old account with `{ allow: false, reason: 'Account switched' }`
2. This prevents signing with the wrong key if requests were queued before the switch
3. New requests use the new active account

---

## 5. Permission Cascade -- `lib/permissions.ts`

Permissions are stored in `browser.storage.local` under key `signerPermissions` as a nested object with account-aware buckets:

```json
{
    "example.com": {
        "_default": {
            "signEvent:1": "allow",
            "signEvent": "deny",
            "nip04Encrypt": "allow",
            "*": "allow"
        },
        "acct_abc123": {
            "signEvent:1": "deny"
        }
    }
}
```

**Mode-based resolution** (controlled by `signerUseGlobalDefaults` flag):
- `useGlobalDefaults=true` -> only check `_default` bucket
- `useGlobalDefaults=false` -> only check account-specific bucket

**Cascade order** (most specific wins):
1. `signEvent:{kind}` -- kind-specific permission (e.g., `signEvent:1`)
2. `signEvent` -- method-level permission
3. `*` -- domain wildcard
4. Default: `"ask"`

**Key properties**:
- Per-domain isolation: permissions for `allowed.com` do not affect `other.com`
- Per-kind isolation: `signEvent:1` (notes) can be allowed while `signEvent:4` (DMs) is denied
- Lock-independent: locking the vault does not change permission decisions

---

## 6. NIP-46 Remote Signing

For accounts of type `nip46`, signing requests are routed to a `Nip46Client` instance (`lib/nip46.ts`) instead of the local vault:

- Client instances are cached per account ID in `_nip46Clients: Map<accountId, Nip46Client>`.
- Ephemeral keypair generated for relay communication.
- Supports `signEvent`, `nip04Encrypt/Decrypt`, `nip44Encrypt/Decrypt` via the remote signer protocol.
- NIP-46 in-flight requests are tracked in `signerPending` but do NOT show badges (no user action needed).
- `nostrconnect://` flow validates a shared secret before accepting the remote signer (see [Security](security.md#7-nip-46-connect-secret)).

---

## 7. Activity Logging

Every sign/encrypt/decrypt operation (both approved and rejected) is logged to `browser.storage.local.activityLog`:

```json
{
    "timestamp": 1708700000000,
    "domain": "example.com",
    "method": "signEvent",
    "kind": 1,
    "decision": "approved"
}
```

The log is capped at 200 entries (newest first, oldest trimmed).
