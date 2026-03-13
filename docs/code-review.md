# Code Review -- March 2026

Comprehensive audit of the Nostr WoT extension codebase. Two rounds: Round 1 identified 98 findings (57 fixed, 35 deferred, 6 accepted). Round 2 is a fresh audit of the post-fix codebase by 10 parallel Opus agents covering security, performance, code quality, dead code, documentation, and future enhancements.

---

## Table of Contents

1. [Round 1 Summary](#round-1-summary)
2. [Security](#1-security)
3. [Performance & Optimizations](#2-performance--optimizations)
4. [Code Quality & Dead Code](#3-code-quality--dead-code)
5. [Documentation Issues](#4-documentation-issues)
6. [Future Enhancements & Roadmap](#5-future-enhancements--roadmap)
7. [What Was Done Well](#6-what-was-done-well)
8. [Summary](#summary)

---

## Round 1 Summary

The first review identified 98 findings across security, performance, code quality, and dead code. 57 were fixed, 35 deferred, 6 accepted/wontfix. Key fixes included: XOR-split pending onboarding keys (S-6), NWC pubkey verification (S-19), in-memory permission/domain caches (P-2.x), misc-handlers split (Q-6.1), `buildPrivilegedMethods()` auto-derivation (Q-4.1), persistent NIP-07/WebLN ports (P-2.7), and centralized constants (Q-6.2).

---

## 1. Security

### HIGH

#### S-R2-1: `sendPayment` auto-approves when permission is `allow` regardless of amount
- **File:** `lib/bg/wallet-handlers.ts:80-107`
- **Description:** When `perm === 'allow'`, the auto-approve threshold is checked but the prompt is only shown when `perm === 'ask'`. If a user previously clicked "remember" (saving `allow`), ALL payments from that domain bypass the threshold and prompt entirely, even large amounts.
- **Attack scenario:** A site previously granted `allow` sends a large invoice -- payment executes without confirmation.
- **Fix:** When `perm === 'allow'` and amount exceeds threshold, fall through to the prompt instead of auto-approving.

#### S-R2-2: `wallet_payInvoice` has no permission check or amount validation
- **File:** `lib/bg/wallet-handlers.ts:184-188`
- **Description:** This privileged handler pays any BOLT11 invoice without permission check, amount validation, or user confirmation. While gated to extension-internal pages, any XSS in popup/onboarding could drain the wallet.
- **Fix:** Add the same amount check + threshold + confirmation flow that `webln_sendPayment` uses, or at minimum validate the BOLT11 format.

### MEDIUM

| ID | File | Description |
|----|------|-------------|
| S-R2-3 | `wallet-handlers.ts:112-117` | `webln_makeInvoice` has no permission check -- any connected domain can generate invoices |
| S-R2-4 | `wallet-handlers.ts:50` | `webln_enable` always returns `true` without checking domain wallet access |
| S-R2-5 | `wallet/lnbits.ts:29-33` | LNbits admin key sent over HTTP (warns only, should block non-localhost HTTP) |
| S-R2-6 | `vault.ts:49-64` | `toStoragePayload` creates immutable hex/mnemonic strings during save (JS limitation) |
| S-R2-7 | `onboarding-handlers.ts:348-355` | `onboarding_createVault` falls back to raw `params.account` if pending account mismatch |
| S-R2-8 | `state.ts:77-103` | No rate limiting for NIP-07 or WebLN methods (only WoT methods are limited) |
| S-R2-9 | `wallet-handlers.ts:135-146` | `wallet_connect` accepts unvalidated `walletConfig` (no URL/format checks) |
| S-R2-10 | `wallet/nwc.ts:186-187` | NWC WebSocket relay URL not validated for `wss://` protocol |
| S-R2-11 | `wallet-handlers.ts:157-163` | `wallet_setAutoApproveThreshold` has no upper bound validation |

### LOW

| ID | File | Description |
|----|------|-------------|
| S-R2-12 | `wallet/nwc.ts:66-77` | NWC secret key persists as class field until explicit `disconnect()` |
| S-R2-13 | `accounts.ts:137-162` | `importNsec` does not zero intermediate `privkeyBytes` after use |
| S-R2-14 | `vault.ts:378-384` | NIP-46 ephemeral key stored as hex string (not zeroable) |
| S-R2-15 | `content.ts:96-116` | Port serialization can cause request starvation on unanswered prompts |
| S-R2-16 | `state.ts:147-153` | CSS sanitization incomplete (strips `@import`/`url()`/`expression()` but not all vectors) |
| S-R2-17 | `nip07-handlers.ts:42` | No upper bound on event kind number |
| S-R2-18 | `background.ts:183-200` | WoT methods not gated behind domain allowlist (privacy -- any site can query social graph) |

### Carried from Round 1 (previously fixed/accepted)

| ID | Status | Description |
|----|--------|-------------|
| S-6 | FIXED | Pending onboarding XOR-split |
| S-19 | FIXED | NWC pubkey verification |
| S-9 | FIXED | NIP-07 input validation |
| S-17 | FIXED | Invoice amount in payment prompt |
| S-18 | FIXED | Auto-approve threshold enforcement |
| S-20 | FIXED | NostrConnect session key zeroing |
| S-1 | FIXED | signEvent zeroing contract documented |
| S-4 | DEFERRED | Empty password vault mode warning UI |
| S-2, S-5, S-13 | ACCEPTED | Inherent JS string/architecture limitations |

---

## 2. Performance & Optimizations

### HIGH

#### P-R2-1: Full IndexedDB graph loaded on every service worker wake
- **File:** `background.ts:68-127`, `lib/storage.ts:132-174`
- **Description:** `loadConfig()` calls `storage.initDB()` which does `loadPubkeyCache()` + `loadGraphCache()` via `store.getAll()`. For a 100K-node graph, this reads the entire `follows_v2` store into memory on every service worker restart (Chrome kills workers after ~5 minutes of inactivity).
- **Impact:** +0.5-3s startup latency per wake cycle.
- **Fix:** Lazy-load graph cache on first query instead of eagerly on startup. The BFS `ensureCache` pattern already supports this.

#### P-R2-2: 8-10 async storage reads per `signEvent` request
- **File:** Multiple (background.ts, domain-handlers.ts, signer.ts, permissions.ts)
- **Description:** A single `nip07_signEvent` request triggers: `isDomainAllowed` (1), `isActiveAccountReadOnly` (1), `isIdentityDisabled` (1, **uncached**), `getActiveAccountInfo` (1, **duplicate of step 2**), `vault.exists` (1), `permissions.check` (2, cached), `getActivePublicKey` (1, **uncached**), `session.get('signerPending')` (1). Total: 8-10 reads + 1-2 writes.
- **Fix:** Cache `isIdentityDisabled` and `getActivePublicKey`. Eliminate duplicate `getActiveAccountInfo`. Pass already-fetched data through the handler chain.

#### P-R2-3: No WebSocket connection pooling
- **File:** `lib/bg/profile-handlers.ts:39-91`, `lib/bg/publish-handlers.ts:18-67`
- **Description:** Every profile fetch opens N fresh WebSockets (one per relay). A batch of 10 profiles = 30 connections. Every event broadcast also opens new connections. TCP+TLS handshake adds 200-500ms per connection.
- **Fix:** Shared relay connection pool with 30-second keep-alive. Batch profile queries into multi-author REQ filters.

### MEDIUM

| ID | File | Description |
|----|------|-------------|
| P-R2-4 | `lib/bg/activity-handlers.ts:34-57` | `logActivity()` full read-modify-write per NIP-07 call (buffer writes in memory) |
| P-R2-5 | Multiple popup files | 13-15 RPC round-trips on popup open (batch into 1-2 calls) |
| P-R2-6 | `lib/storage.ts:418-457` | `getDatabaseSize()` does `store.getAll()` full table scan (compute from in-memory cache) |
| P-R2-7 | `lib/signer.ts:96-103` | `getActivePublicKey()` reads `storage.sync` every call (cache in memory) |
| P-R2-8 | `lib/bg/domain-handlers.ts:172-175` | `isIdentityDisabled()` uncached storage read per NIP-07 call |
| P-R2-9 | `lib/bg/state.ts:68` | Profile cache unbounded (no LRU eviction, grows without limit) |
| P-R2-10 | `lib/bg/domain-handlers.ts:235-291` | `injectIntoTab` does 3 sequential storage reads + 4 scripting calls |
| P-R2-11 | `lib/signer.ts:147-193` | Signer pending queue: session storage I/O per request (keep in-memory, sync on timer) |
| P-R2-12 | `signer.ts:38` | `nostr-tools/nip46` statically imported but rarely used (dynamic import instead) |
| P-R2-13 | `background.ts:68-127` | `loadConfig()` sequential storage reads (parallelize sync + local) |
| P-R2-14 | `AccountContext.tsx:52-143` | Profile cache update re-renders all consumers (split context) |

### LOW

| ID | File | Description |
|----|------|-------------|
| P-R2-15 | `lib/graph.ts:395` | `getPath()` uses `unshift()` in loop (use `push()` + `reverse()`) |
| P-R2-16 | `lib/sync.ts:454` | `toFetch.shift()` is O(n) on large arrays (use index variable) |
| P-R2-17 | `background.ts:209-231` | `npubToHex()` runs bech32 decode on every request regardless of method |
| P-R2-18 | `useRpc.ts:28-32` | `JSON.stringify` called twice per render for param comparison |
| P-R2-19 | `PopupApp.tsx:48-51` | Screenshot capture competes with startup RPC calls |
| P-R2-20 | `domain-handlers.ts:376-388` | `onActivated` re-injects even if badge engine already running |

### Carried from Round 1 (previously fixed)

| ID | Status | Description |
|----|--------|-------------|
| P-2.1-2.3 | FIXED | Permission/domain/account caches |
| P-2.6 | FIXED | Activity log write buffering |
| P-2.7 | FIXED | Persistent NIP-07/WebLN ports |
| P-1.1 | FIXED | nostr-tools/pure removal |
| P-7.2 | FIXED | VaultContext `Promise.all()` |
| P-7.3 | FIXED | HomeTab conditional polling |
| P-6.1, P-6.2 | FIXED | sha256 sync, arrayToBase64 chunked |
| P-7.1, P-7.5 | FIXED | useRpc paramsRef, useBrowserStorage defaultRef |
| P-5.2 | FIXED | Badge refresh debounced |

---

## 3. Code Quality & Dead Code

### HIGH -- Dead Constants

#### Q-R2-1: 10 of 15 constants in `lib/constants.ts` are never imported
- **File:** `lib/constants.ts`
- **Description:** The centralized constants file was created but most consumers hardcode their own values instead.

| Dead Constant | Hardcoded In |
|---------------|-------------|
| `PBKDF2_ITERATIONS` | `vault.ts:30`, `nip49.ts:17` (local copies) |
| `MIN_PASSWORD_LENGTH` | 9 files hardcode `8` |
| `DEFAULT_AUTO_LOCK_MS` | Not imported anywhere |
| `MUTE_LIST_FETCH_TIMEOUT_MS` | `profile-handlers.ts` hardcodes `8000`/`4000` |
| `WOT_CALL_TIMEOUT_MS` | `inject.ts` hardcodes `30_000` |
| `NIP07_CALL_TIMEOUT_MS` | `inject.ts` hardcodes `120_000` |
| `WEBLN_CALL_TIMEOUT_MS` | `inject.ts` hardcodes `120_000` |
| `CONTENT_RATE_LIMIT_PER_SECOND` | `content.ts` hardcodes `100` |
| `ONBOARDING_PENDING_TTL_MS` | `onboarding-handlers.ts:38` local copy |
| `ACTIVITY_LOG_GLOBAL_MAX` | Not imported (P-3.3 incorrectly marked FIXED) |
| `NWC_REQUEST_TIMEOUT_MS` | `nwc.ts` local copy |

- **Fix:** Either wire constants into their consumers or remove dead ones. `inject.ts` cannot import (IIFE) but `content.ts` can.

### HIGH -- Type Safety

#### Q-R2-2: 60+ `any` types across 24 UI component files
- **File:** `src/popup/components/Wizard/*.tsx`, `ApprovalOverlay.tsx`, `WotInjectionSection.tsx`, `WotSyncSection.tsx`, `PermissionsSection.tsx`, `AccountDropdown.tsx`, `MenuOverlay.tsx`, `PromptApp.tsx`
- **Description:** Wizard steps type account objects as `any`. Settings components use `any` for storage data. Catch blocks use `catch (e: any)` instead of `catch (e: unknown)`.
- **Fix:** Import `Account`, `SafeAccount`, `PendingRequest`, `StorageStats` from `lib/types.ts`. Use `unknown` with type narrowing in catch blocks.

### HIGH -- Test Coverage

#### Q-R2-3: No tests for the three largest core modules
- **Files:** `lib/storage.ts` (767 lines), `lib/signer.ts` (762 lines), `lib/sync.ts` (565 lines)
- **Description:** The WoT data layer (IndexedDB, graph cache, write buffering, delta encoding) and the signing coordinator have zero test coverage. Also untested: `lib/graph.ts` (426 lines), `lib/scoring.ts`, `lib/api.ts`, `lib/i18n.ts`.
- **Fix:** Create test files for these modules. Priority: `scoring.test.ts` (pure logic, easy to test), `graph.test.ts` (with mock storage), `storage.test.ts` (needs `fake-indexeddb`).

### MEDIUM -- Duplicated Logic

| ID | Description |
|----|-------------|
| Q-R2-4 | `PBKDF2_ITERATIONS` defined in 3 files (`constants.ts`, `vault.ts`, `nip49.ts`) -- mismatch could silently break decryption |
| Q-R2-5 | `PendingRequest` interface defined in 3 places (`lib/types.ts`, `lib/sync.ts`, `ApprovalOverlay.tsx`) with different shapes |
| Q-R2-6 | `Account` interface duplicated locally in `AccountContext.tsx` and `HomeTab.tsx` instead of importing from `lib/types.ts` |
| Q-R2-7 | Browser compat layer defined in 3 files (`lib/browser.ts`, `src/shared/browser.ts`, inline in `lib/i18n.ts`) |
| Q-R2-8 | `normalizeConfig` duplicated in `badges/engine.ts` and `src/shared/adapterDefaults.ts` (IIFE constraint -- documented, acceptable) |
| Q-R2-9 | Badge engine duplicates ~130 lines of bech32 from `lib/crypto/bech32.ts` (IIFE constraint -- acceptable but test parity needed) |

### MEDIUM -- Code Smells

| ID | Description |
|----|-------------|
| Q-R2-10 | `lib/accounts.ts` still uses `.js` import extensions (all other `lib/` files use `.ts`) |
| Q-R2-11 | ~50 empty `catch {}` blocks without comments explaining why errors are suppressed |
| Q-R2-12 | `lib/storage.ts` has 12 mutable module-level variables (consider grouping into `StorageState` object) |

### MEDIUM -- Dead/Test-Only Exports

| Export | File | Used Only In |
|--------|------|-------------|
| `schnorrSign`, `schnorrVerify` | `lib/crypto/schnorr.ts` | Tests only |
| `masterKeyFromSeed` | `lib/crypto/bip32.ts` | Tests only |
| `verifyEvent`, `computeEventId` | `lib/crypto/nip01.ts` | Tests only |
| `liftX`, `N`, `isValidPrivateKey` | `lib/crypto/secp256k1.ts` | Tests only |
| `writeU32BE`, `readU32BE` | `lib/crypto/utils.ts` | Tests only |
| `entropyToMnemonic` | `lib/crypto/bip39.ts` | Tests only |
| `nprofileEncode` | `lib/crypto/bech32.ts` | Not used anywhere |
| `vault.getActiveAccount()` | `lib/vault.ts` | Tests only |
| `hasWalletConfig` | `lib/wallet/index.ts` | Tests only |

### Carried from Round 1 (previously fixed)

| ID | Status | Description |
|----|--------|-------------|
| Q-1.1 | FIXED | `handleNip46Request` typed |
| Q-2.2 | FIXED | Non-null assertions replaced with helpers |
| Q-3.1 | FIXED | AsyncLock extracted |
| Q-4.1 | FIXED | Privileged methods auto-derived |
| Q-6.1 | FIXED | misc-handlers split |
| Q-1.3 | FIXED | `WotMode` union type |
| Q-4.3 | FIXED | Handler collision check |
| Q-4.4 | FIXED | `createChannel()` factory |
| Q-5.2, Q-5.3 | FIXED | HomeTab hooks, PopupApp overlay union |
| Q-1.9, Q-1.10 | FIXED | Import extensions, private modifiers |
| Q-4.5 | FIXED | `upgradeDatabase()` helper |

---

## 4. Documentation Issues

### CRITICAL

#### D-R2-1: `CONTRIBUTING.md` is severely outdated
- Nearly every claim is factually wrong: says "no build step required", "plain ES modules", "no external dependencies", uses `.js` extensions throughout, shows wrong project structure, wrong test commands, wrong loading instructions.
- **Fix:** Complete rewrite reflecting TypeScript, Vite build system, actual project structure.

#### D-R2-2: `SECURITY.md` (root) has multiple errors
- Uses `.js` extensions, wrong rate limit numbers (says 1000/10, actual is 100/50), wrong privilege gate code, claims "zero external dependencies."
- **Fix:** Rewrite with correct facts.

### HIGH

| ID | File | Description |
|----|------|-------------|
| D-R2-3 | `docs/architecture.md` | Handler modules table lists `misc-handlers.ts` as a real module (now a re-export facade). Missing `activity-handlers.ts`, `profile-handlers.ts`, `publish-handlers.ts` |
| D-R2-4 | `docs/security.md` | Privileged methods list is stale and manually maintained (code auto-derives via `buildPrivilegedMethods()`) |
| D-R2-5 | `docs/security.md` | Privilege gate code snippet doesn't match actual `!sender.tab` logic |
| D-R2-6 | N/A | No `docs/permissions.md` -- the permission system (buckets, cascade, migration, global-defaults mode) is undocumented |
| D-R2-7 | `docs/architecture.md` | Missing `lib/constants.ts`, `lib/utils/async-lock.ts`, `lib/relay.ts`, `lib/i18n.ts`, `lib/scoring.ts`, `lib/api.ts` from file listings |
| D-R2-8 | `docs/architecture.md` | `WalletProvider` interface description missing `listTransactions()` method |

### MEDIUM

| ID | File | Description |
|----|------|-------------|
| D-R2-9 | `docs/architecture.md` | Manifest snippet shows `optional_permissions: ["notifications"]` (doesn't exist) |
| D-R2-10 | `docs/message-flow.md` | Says "switch on method" (actually Map lookup); missing port-based messaging description |
| D-R2-11 | `docs/signer.md` | References nonexistent `lib/nip46.ts` (NIP-46 is in `lib/signer.ts` via `nostr-tools/nip46`) |
| D-R2-12 | `docs/crypto.md` | References nonexistent `bip39-wordlist.js`; says "implemented from scratch" (delegates to `@noble`/`@scure`) |
| D-R2-13 | `docs/code-review.md` | P-3.3 incorrectly marked FIXED (`ACTIVITY_LOG_GLOBAL_MAX` defined but never imported) |
| D-R2-14 | `docs/testing.md` | Missing test files: `relay.test.ts`, `inject-webln.test.ts`, `vault-wallet.test.ts` |
| D-R2-15 | `CLAUDE.md` | Missing wallet test commands in Key Commands section; spelling "Commiting" |
| D-R2-16 | `.github/workflows/tests.yml` | CI missing: badge tests, wallet tests, vault-wallet tests, inject-webln tests, `npm run typecheck` |
| D-R2-17 | `docs/README.md` | Missing `docs/code-review.md` from index |

---

## 5. Future Enhancements & Roadmap

### P0 -- Next (foundations)

| Enhancement | Effort | Description |
|-------------|--------|-------------|
| WoT core test coverage | M | Tests for `scoring.ts`, `graph.ts`, `api.ts`, `storage.ts` (the extension's differentiator is untested) |
| CI completeness | S | Add badge, wallet, inject-webln, vault-wallet tests + `npm run typecheck` to CI workflow |

### P1 -- Near-term

| Enhancement | Effort | Description |
|-------------|--------|-------------|
| NIP-65 relay list metadata | M | Replace static relay config with kind:10002 events; sync engine uses relay hints per pubkey |
| NIP-46 session improvements | M | Reconnection with backoff, `nip46_getSessionInfo` handler, post-onboarding bunker connect |
| Mute lists in scoring | M | Integrate mute lists as negative trust signals in `calculateScore()` |
| Graph performance at scale | M | Flat adjacency array, incremental BFS updates, Web Worker for BFS |
| CSP for extension pages | S | Add `content_security_policy` to `manifest.json` |
| Progressive onboarding | M | "Getting Started" checklist tracking identity setup, first site, first sync, wallet |
| Multi-account quick switcher | S | Keyboard shortcuts + dropdown for fast account switching |
| Firefox database registry | M | Workaround for `indexedDB.databases()` not available in Firefox |

### P2 -- Medium-term

| Enhancement | Effort | Description |
|-------------|--------|-------------|
| NIP-05 verification display | S | Show verified NIP-05 address in badge tooltips |
| NIP-57 zap receipt flow | L | Kind:9734 zap requests + kind:9735 receipt verification |
| Trust path visualization | M | Interactive shortest-path display with profile avatars |
| Payment history analytics | M | Transaction categorization, spend graphs, CSV export |
| LNURL-pay/withdraw | M | Native LNURL support in wallet send UI |
| Cashu ecash support | L | New `CashuProvider` implementing `WalletProvider` interface |
| Settings reorganization | M | Tab-based settings to scale with growing feature set |
| Relay privacy (rotation) | M | Distribute queries so no relay sees full graph interest |
| i18n completeness audit | S | Scan for hardcoded English strings in `.tsx` files |

### P3 -- Long-term

| Enhancement | Effort | Description |
|-------------|--------|-------------|
| NIP-78 settings sync | S | Store extension preferences as encrypted Nostr events for cross-device sync |
| Weighted graph edges | L | Incorporate interaction signals (replies, reactions, zaps) as edge weights |
| Configurable max hops | S | User-configurable `maxHops` in settings |
| Per-domain auto-approve threshold | S | Different payment thresholds per trusted site |
| E2E browser testing | XL | Playwright with extension loaded for cross-browser E2E |
| Safari support | XL | Feasible but requires significant refactoring (no `storage.session`, limited `scripting`) |
| Encrypted backup/restore | L | Full vault + settings export as encrypted blob |

---

## 6. What Was Done Well

These deserve explicit recognition:

- **Vault encryption** -- AES-256-GCM + PBKDF2 with 210,000 iterations. Random salt and IV per encryption. Non-extractable CryptoKey.
- **Crypto key hygiene** -- Private keys consistently zeroed with `fill(0)` in `try/finally` blocks across vault, signer, wallet, and NIP-04/NIP-44 modules. In-memory `MemoryAccount` uses `Uint8Array` (zeroable) instead of hex strings.
- **Audited crypto libraries** -- All secp256k1, schnorr, BIP-32, BIP-39 operations delegate to `@noble/curves`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39`. No homebrew elliptic curve math.
- **Constant-time comparison** -- `constantTimeEqual()` correctly uses XOR accumulation without early return for MAC verification.
- **Origin derivation** -- Background derives origin from `sender.tab?.url` (browser-verified, tamper-proof) rather than trusting message `origin` field. Frame-aware with `sender.frameId` check.
- **Privilege gating** -- `PRIVILEGED_METHODS` auto-derived from handler maps. Sender verified via `sender.id === browser.runtime.id` and URL prefix check.
- **Three-channel isolation** -- WoT, NIP-07, and WebLN message channels strictly separated with per-channel allowlists in content.ts.
- **Method allowlisting** -- `NIP07_ALLOWED_METHODS`, `WOT_ALLOWED_METHODS`, `WEBLN_ALLOWED_METHODS` prevent content scripts from invoking privileged methods.
- **HTTPS enforcement** for NIP-07 and WebLN in content.ts (except localhost).
- **Rate limiting** on content script (100/sec WoT) and background (50/sec/method).
- **Crypto-random request IDs** in inject.ts preventing response spoofing.
- **BFS cache with typed arrays** -- `Uint8Array`/`Uint32Array` for O(1) distance lookups. Delta-encoded storage for memory efficiency.
- **Write buffering** -- Batched IDB writes during sync with configurable flush thresholds.
- **Dependency injection** -- `NwcCryptoDeps`, injectable `fetchFn` in wallet providers enabling comprehensive test coverage.
- **Oracle response validation** -- Validates every remote response before casting.
- **Permission system** -- Per-domain, per-account, per-kind with migration functions and global-defaults mode.
- **AsyncLock** -- Serializes concurrent storage writes to prevent read-modify-write races.
- **NIP-04 error normalization** -- Generic "Decryption failed" prevents padding oracle attacks.
- **NIP-46 auth URL sanitization** -- Rejects non-HTTPS auth URLs to prevent `javascript:` URI injection.
- **Onboarding XOR-split** -- Private keys in pending onboarding split across two session storage keys using XOR masking.

---

## Summary

### Round 2 Findings by Category

| Category | HIGH | MEDIUM | LOW | Total |
|----------|------|--------|-----|-------|
| Security | 2 | 9 | 7 | 18 |
| Performance | 3 | 11 | 6 | 20 |
| Code Quality | 3 | 12 | -- | 15 |
| Documentation | 2 | 15 | -- | 17 |
| **Total** | **10** | **47** | **13** | **70** |

### Top 10 Priorities

1. **S-R2-1/S-R2-2** -- Fix wallet payment auto-approve bypass and `wallet_payInvoice` permission gap
2. **Q-R2-1** -- Wire `lib/constants.ts` into consumers or remove dead constants
3. **Q-R2-3** -- Write tests for `scoring.ts`, `graph.ts`, `storage.ts`, `sync.ts`
4. **D-R2-1/D-R2-2** -- Rewrite `CONTRIBUTING.md` and `SECURITY.md`
5. **P-R2-2** -- Cache `isIdentityDisabled`, `getActivePublicKey`; eliminate duplicate reads
6. **P-R2-1** -- Lazy-load graph cache instead of eager full load on SW wake
7. **P-R2-3** -- Relay connection pool for profile fetches and event broadcasts
8. **P-R2-5** -- Batch popup RPC calls (13-15 round-trips -> 1-2)
9. **Q-R2-2** -- Replace 60+ `any` types with proper types from `lib/types.ts`
10. **D-R2-16** -- Add missing test suites and typecheck to CI workflow
