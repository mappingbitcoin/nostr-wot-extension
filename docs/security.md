# Security

## 1. Vault -- `lib/vault.ts`

The vault encrypts sensitive account data (private keys, mnemonics) at rest using Web Crypto APIs.

**Encryption scheme:**

1. User password fed to PBKDF2 with SHA-256, 210,000 iterations, random 32-byte salt, producing a 256-bit AES key.
2. AES-256-GCM encrypts the vault payload JSON with a random 12-byte IV.
3. Stored in `browser.storage.local` under key `keyVault`:

```json
{
    "version": 1,
    "salt": "<base64>",
    "iv": "<base64>",
    "ciphertext": "<base64>"
}
```

**Auto-lock**: Configurable timeout (default 15 minutes / 900,000ms). When the timer fires, `lock()` zeroes all in-memory key material and sets `_decrypted = null` and `_cryptoKey = null`. The background script also calls `clearWalletProviders()` on lock to disconnect and discard cached wallet provider instances. On Chrome, service worker termination also naturally clears memory.

---

## 2. In-Memory Key Format -- `MemoryVaultPayload`

Private keys are stored differently on disk vs in memory:

| Layer | Format | Zeroable? |
|-------|--------|-----------|
| Disk (JSON) | `Account.privkey: string` (hex) | N/A |
| Memory | `MemoryAccount.privkeyBytes: Uint8Array` | Yes |
| Disk (JSON) | `Account.mnemonic: string` | N/A |
| Memory | `MemoryAccount.mnemonicBytes: Uint8Array` | Yes |

On `unlock()`, hex strings are converted to `Uint8Array` via `toMemoryAccount()`. On `lock()`, every account's `privkeyBytes` and `mnemonicBytes` are zeroed with `.fill(0)` before the reference is nulled. This prevents hex strings (which are immutable JS strings and cannot be zeroed) from lingering in the GC heap.

On `save()` and `reEncrypt()`, memory format is serialized back to JSON via `toStoragePayload()`.

---

## 3. Private Key Handling

`vault.getPrivkey()` returns a **copy** of the private key as `Uint8Array(32)` -- `new Uint8Array(acct.privkeyBytes)`. The caller MUST zero the returned array after use with `privkey.fill(0)` in a `try/finally` block. Because it's a copy, the caller's `fill(0)` does not affect the vault's internal state.

```ts
const privkey = vault.getPrivkey();
if (!privkey) throw new Error('No private key');
try {
    return await cryptoSignEvent(event, privkey);
} finally {
    privkey.fill(0);
}
```

---

## 4. Vault `reEncrypt()` Method

Changes the vault password without exposing private keys as intermediate hex strings:

1. Validates vault is unlocked and new password meets minimum length (8 chars, or empty for never-lock mode)
2. Generates new random salt + derives new AES key
3. Serializes `MemoryVaultPayload` -> `VaultPayload` JSON -> encrypts with new key
4. Stores new encrypted vault, replaces internal `_cryptoKey`

This avoids the old `getDecryptedPayload()` + `lock()` + `create()` pattern which created an intermediate JSON copy with hex private key strings.

---

## 5. NIP-49 Zeroing (`lib/crypto/nip49.ts`)

- **`ncryptsecEncode`**: The input `privkeyBytes` is zeroed in a `finally` block after encryption.
- **`ncryptsecDecode`**: The decrypted `Uint8Array` view is zeroed after extracting the hex string.

---

## 6. NIP-04 Error Normalization (`lib/crypto/nip04.ts`)

AES-CBC decrypt errors are caught and re-thrown as a generic `"Decryption failed"` message. This prevents padding oracle attacks where different error messages for "wrong padding" vs "wrong key" would leak information about the plaintext.

---

## 7. NIP-46 Connect Secret (`lib/nip46.ts`)

The `nostrconnect://` QR code flow includes a `connectSecret` parameter:
- A random 16-byte hex string is generated and included in the QR URI
- The `Nip46Client` validates that the incoming connect request's `params[1]` matches the secret
- After successful validation, the secret is cleared (one-time use)
- Requests with wrong or missing secrets are silently ignored

---

## 8. Privileged Method Gating

The `PRIVILEGED_METHODS` set in `background.ts` contains all sensitive operations:

- **Vault lifecycle**: `vault_unlock`, `vault_lock`, `vault_create`, `vault_isLocked`, `vault_exists`, `vault_listAccounts`, `vault_addAccount`, `vault_removeAccount`, `vault_setActiveAccount`, `vault_getActivePubkey`, `vault_setAutoLock`, `vault_getAutoLock`, `vault_exportNsec`, `vault_exportNcryptsec`, `vault_importNcryptsec`, `vault_changePassword`, `vault_getActiveAccountType`
- **Signer permissions**: `signer_getPermissions`, `signer_getPermissionsForDomain`, `signer_clearPermissions`, `signer_savePermission`, `signer_getPermissionsRaw`, `signer_getPermissionsForDomainRaw`, `signer_copyPermissions`, `signer_getUseGlobalDefaults`, `signer_setUseGlobalDefaults`
- **Pending requests**: `signer_getPending`, `signer_resolve`, `signer_resolveBatch`
- **Account switching**: `switchAccount`
- **Onboarding**: `onboarding_validateNsec`, `onboarding_validateNcryptsec`, `onboarding_validateNpub`, `onboarding_connectNip46`, `onboarding_generateAccount`, `onboarding_exportNcryptsec`, `onboarding_saveReadOnly`, `onboarding_createVault`, `onboarding_addToVault`, `onboarding_initNostrConnect`, `onboarding_pollNostrConnect`, `onboarding_cancelNostrConnect`
- **Graph & sync**: `configUpdated`, `syncGraph`, `stopSync`, `clearGraph`, `getSyncState`
- **Domain management**: `requestHostPermission`, `enableForCurrentDomain`, `addAllowedDomain`, `removeAllowedDomain`, `getAllowedDomains`, `isDomainAllowed`, `hasHostPermission`
- **Badge injection**: `setBadgeDisabled`, `removeBadgesFromTab`, `getCustomAdapters`, `saveCustomAdapter`, `deleteCustomAdapter`, `previewBadgeConfig`, `setIdentityDisabled`, `getIdentityDisabledSites`, `injectWotApi`, `getNostrPubkey`
- **Database management**: `listDatabases`, `getDatabaseStats`, `deleteAccountDatabase`, `deleteAllDatabases`
- **Activity log**: `getActivityLog`, `clearActivityLog`
- **Filters**: `getLocalBlocks`, `addLocalBlock`, `removeLocalBlock`, `fetchMuteList`, `getMuteLists`, `removeMuteList`, `toggleMuteList`, `saveMuteList`
- **Publishing**: `publishRelayList`, `signAndPublishEvent`, `signEvent`, `updateProfileCache`, `getProfileMetadata`
- **NIP-46 sessions**: `nip46_getSessionInfo`, `nip46_revokeSession`
- **Health checks**: `checkRelayHealth`, `checkOracleHealth`

All gated by: `sender.id === browser.runtime.id && sender.url.startsWith(extensionBaseUrl)`.

---

## 9. Rate Limiting

`RATE_LIMITED_METHODS` covers WoT computation methods only (50 req/sec per method). `vault_unlock` is protected by the privilege gate (only callable from extension pages) and PBKDF2's 210,000 iterations which make brute-force impractical (~200ms per attempt).

---

## 10. Profile Verification

When fetching kind:0 profile metadata, events are validated for matching `event.pubkey` and `event.kind` before being cached:

```ts
if (event.pubkey !== pubkey || event.kind !== 0) return;
```

---

## 11. Data Sanitization

When returning account objects from public APIs, sensitive fields are stripped:

```ts
const { privkeyBytes, mnemonicBytes, ...safe } = acct;
return safe;
```

`getActiveAccount()`, `getAccountById()`, and `listAccounts()` all strip key bytes. `getDecryptedPayload()` reconstructs hex format for JSON export but is only callable when unlocked.
