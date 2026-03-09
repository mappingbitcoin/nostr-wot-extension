# Wallet -- Lightning Payments & Zaps

## 1. Overview

The extension includes a built-in Lightning wallet that exposes `window.webln` for web applications. Nostr clients that support WebLN (Primal, Coracle, Snort, etc.) can use it directly for zaps (NIP-57).

Two wallet backends are supported behind a unified `WalletProvider` interface:

| Provider | Transport | Use case |
|----------|-----------|----------|
| **NWC** (NIP-47) | Nostr relays | Connect an existing wallet via `nostr+walletconnect://` URI |
| **LNbits** | HTTPS REST API | Auto-provision or connect a custodial LNbits wallet |

---

## 2. Architecture

```
Nostr client (window.webln.sendPayment)
  |
inject.ts  ──>  WEBLN_REQUEST { method, params }
  |
content.ts ──>  validate allowlist + prefix 'webln_' + append origin
  |
background.ts  ──>  permission check → provider dispatch
  |
WalletProvider interface
  ├── NwcProvider   (NIP-47 over Nostr relays)
  └── LnbitsProvider (REST API over HTTPS)
```

This mirrors the NIP-07 signer flow: inject.ts exposes the API, content.ts bridges and validates, background.ts dispatches to the provider.

---

## 3. File Structure

```
lib/wallet/
  types.ts              # WalletConfig, WalletProvider, Transaction, SafeWalletInfo
  index.ts              # Factory + per-account provider cache
  nwc.ts                # NWC (NIP-47) provider
  lnbits.ts             # LNbits REST provider
  lnbits-provision.ts   # Auto-provisioning via challenge-response
  bolt11.ts             # BOLT11 invoice decoder

src/popup/components/
  Wallet/
    Wallet.tsx           # Connected wallet UI (balance, send, deposit, settings)
    WalletSetup.tsx      # Setup flow (Quick Setup / NWC / LNbits tabs)

tests/wallet/
  nwc.test.ts            # NWC provider tests
  lnbits.test.ts         # LNbits provider tests
  lnbits-provision.test.ts # Auto-provisioning tests
  bolt11.test.ts         # BOLT11 decoder tests
  background-handlers.test.ts # Background RPC handler tests
  permissions.test.ts    # Wallet permission tests
  approval.test.ts       # Payment approval flow tests
  types.test.ts          # Type guard tests
  index.test.ts          # Factory/cache tests
```

---

## 4. WalletProvider Interface

```typescript
interface WalletProvider {
  readonly type: 'nwc' | 'lnbits';
  getInfo(): Promise<{ alias?: string; methods: string[] }>;
  getBalance(): Promise<{ balance: number }>;
  payInvoice(bolt11: string): Promise<{ preimage: string }>;
  makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }>;
  listTransactions(limit?: number, offset?: number): Promise<Transaction[]>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}
```

### 4.1 NWC Provider (`nwc.ts`)

- Parses `nostr+walletconnect://` connection string (pubkey + relay + secret)
- Communicates via NIP-47 encrypted events over Nostr relays
- Crypto dependencies injected at runtime (cannot be constructed by the factory directly)
- Created externally via `createNwcProvider()`, then registered with `setWalletProvider()`

### 4.2 LNbits Provider (`lnbits.ts`)

- Connects to a configurable LNbits instance URL
- REST API with admin key in `X-Api-Key` header
- Endpoints: `GET /api/v1/wallet` (balance), `POST /api/v1/payments` (pay/create invoice), `GET /api/v1/payments` (transactions)

### 4.3 Provider Factory (`index.ts`)

Per-account provider cache (`Map<string, WalletProvider>`):
- `getWalletProvider(accountId, config)` — returns cached or creates new
- `setWalletProvider(accountId, provider)` — cache an externally-created provider (NWC)
- `removeWalletProvider(accountId)` — disconnect and remove
- `clearWalletProviders()` — disconnect all, called on vault lock

---

## 5. Auto-Provisioning

Users can instantly provision a wallet via "Quick Setup" without manual key entry.

### Flow

```
User clicks "Create Wallet"
  → GET  {server}/api/provision/challenge     → { challenge }
  → Sign challenge as NIP-98 kind:27235 event
  → POST {server}/api/provision               → { adminkey, id, nwcUri? }
  → Store as LNbits config in vault
  → Initialize provider
```

- Default server: `https://zaps.nostr-wot.com`
- Users can override the server URL in an "Advanced" section
- Wallet name includes npub prefix (`WoT:npub1abc...`) for admin recovery
- Authentication via signed Nostr event — no registration required

### File

`lib/wallet/lnbits-provision.ts` — `provisionLnbitsWallet(instanceUrl, walletName, signFn)`

### 5.2 Lightning Address Claiming

After provisioning, users can claim a Lightning Address (`username@zaps.nostr-wot.com`) that creates an lnurlp pay link for receiving payments.

```
User enters desired username
  → GET  {server}/api/provision/challenge     → { challenge }
  → Sign challenge as NIP-98 kind:27235 event
  → POST {server}/api/claim-username          → { address, payLinkId }
  → Prompt to update profile lud16 field
```

Server endpoints:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/claim-username` | POST | NIP-98 | Claim a username, creates lnurlp pay link |
| `/api/lightning-address` | GET | None | Look up address by pubkey |
| `/api/release-username` | POST | NIP-98 | Delete pay link, release username |

Username validation: `^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$` (3-30 chars). Reserved names blocked.

Client functions in `lib/wallet/lnbits-provision.ts`:
- `claimLightningAddress(instanceUrl, username, signFn)`
- `getLightningAddress(instanceUrl, pubkey)`
- `releaseLightningAddress(instanceUrl, signFn)`

---

## 6. WebLN API

Injected as `window.webln` in inject.ts:

```typescript
window.webln = {
  enabled: false,
  enable(): Promise<void>,
  getInfo(): Promise<{ node: { alias: string; pubkey: string } }>,
  sendPayment(paymentRequest: string): Promise<{ preimage: string }>,
  makeInvoice(args: { amount: number; defaultMemo?: string }): Promise<{ paymentRequest: string }>,
  getBalance(): Promise<{ balance: number }>,
};
```

Fires `CustomEvent('webln-ready')` on `window` after injection.

### Message Channel

| Direction | Type |
|-----------|------|
| Page → Content | `WEBLN_REQUEST` |
| Content → Page | `WEBLN_RESPONSE` |

Allowed methods: `enable`, `getInfo`, `sendPayment`, `makeInvoice`, `getBalance`

HTTPS enforcement and rate limiting apply (same rules as NIP-07).

---

## 7. Permission Model

### 7.1 WebLN Permissions

Same structure as NIP-07, stored per-domain per-account:

```json
{
  "primal.net": {
    "_default": {
      "webln:sendPayment": "ask",
      "webln:makeInvoice": "allow",
      "webln:getBalance": "allow"
    }
  }
}
```

### 7.2 Auto-Approve Threshold

Per-account setting stored in `browser.storage.local` at key `walletThreshold_{accountId}`:

- Payments at or below threshold: auto-approve (no popup)
- Payments above threshold: show approval popup
- Default: `0` (always prompt)

### 7.3 Payment Approval

Extends the existing signer prompt system:
- `sendPayment` requests go through permission check
- If permission is `'ask'`, a prompt is queued via `signer.queueRequest()` with type `webln_sendPayment`
- User sees amount, domain, and can approve/deny with optional "remember" checkbox

---

## 8. Background Handlers

### Privileged (extension pages only)

| Method | Purpose |
|--------|---------|
| `wallet_getInfo` | Get wallet type, connection status |
| `wallet_getBalance` | Get current balance |
| `wallet_connect` | Store wallet config in vault, init provider |
| `wallet_disconnect` | Remove wallet config, destroy provider |
| `wallet_setAutoApproveThreshold` | Set auto-approve threshold (sats) |
| `wallet_getAutoApproveThreshold` | Get current threshold |
| `wallet_makeInvoice` | Generate receive invoice |
| `wallet_payInvoice` | Pay a BOLT11 invoice |
| `wallet_getTransactions` | List transactions (paginated) |
| `wallet_getNwcUri` | Get NWC connection URI (if available) |
| `wallet_hasConfig` | Check if wallet is configured |
| `wallet_provision` | Auto-provision a new LNbits wallet |
| `wallet_claimLightningAddress` | Claim a Lightning Address username |
| `wallet_getLightningAddress` | Look up current Lightning Address |
| `wallet_releaseLightningAddress` | Release a claimed Lightning Address |

### Non-privileged (from web pages via content.ts)

| Method | Purpose |
|--------|---------|
| `webln_enable` | Activate WebLN for the requesting page |
| `webln_sendPayment` | Pay a BOLT11 invoice (goes through permission/approval) |
| `webln_makeInvoice` | Request invoice generation |
| `webln_getBalance` | Get balance |
| `webln_getInfo` | Get wallet info |

---

## 9. BOLT11 Invoice Decoder

`lib/wallet/bolt11.ts` provides lightweight BOLT11 invoice decoding using the existing bech32 infrastructure:

```typescript
interface DecodedInvoice {
  amountSats: number | null;
  description: string | null;
  expiry: number;           // seconds, default 3600
  paymentHash: string | null;
  network: string;          // 'bc' (mainnet), 'tb' (testnet), 'bcrt' (regtest)
  timestamp: number;
}

decodeBolt11(invoice: string): DecodedInvoice | null
```

Used in the Send modal to preview invoice details (amount, description, expiry) before payment.

---

## 10. Wallet Configuration Storage

Wallet credentials (`WalletConfig`) are stored inside the `Account` object in the encrypted vault — same AES-256-GCM + PBKDF2 protection as private keys:

```typescript
type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string; nwcUri?: string };
```

See [Storage](storage.md#9-wallet-storage) and [Security](security.md#8-wallet-security) for details.

---

## 11. UI Structure

### Home Screen (HomeTab)

- **Wallet exists**: Shows a balance card at the top with sats amount. Clicking opens the wallet section in the menu.
- **No wallet**: Shows a setup banner inviting the user to create/link a wallet. Only appears after profile suggestion and sync reminder banners are resolved. Dismissible per account.

### Wallet Section (Menu → Wallet)

**Setup flow** (`WalletSetup.tsx`):
- Three tabs: Quick Setup / NWC / LNbits
- Quick Setup: one-click provisioning with optional advanced URL override
- NWC: paste `nostr+walletconnect://` URI
- LNbits: enter instance URL + admin key

**Connected wallet** (`Wallet.tsx`):
- **Balance card** with gear icon for settings
- **Deposit/Send buttons** — open centered modals (rendered via `createPortal` to escape parent overflow)
- **Transaction list** with search and pagination
- **Settings overlay** (full-page): provider info + disconnect, NWC URI copy, auto-approve threshold, Lightning Address claim/view (LNbits only)

### NIP-57 Zap Flow

The extension provides primitives; the Nostr client orchestrates:

```
Client: user clicks "Zap 1000 sats"
  1. Client looks up recipient's lud16
  2. Client queries LNURL → pay params
  3. Client builds kind:9734 zap request
  ──> window.nostr.signEvent(zapRequest)     → Extension signs it
  4. Client sends zap request to LNURL endpoint → bolt11 invoice
  ──> window.webln.sendPayment(bolt11)       → Extension pays it
  5. Recipient's service publishes kind:9735 receipt
```
