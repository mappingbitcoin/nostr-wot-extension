# Architecture

## 1. Overview

The Nostr WoT Extension is a Manifest V3 browser extension that combines two capabilities:

1. **NIP-07 Identity Provider (Signer)** -- Exposes `window.nostr` for web applications to request public keys, event signing, and NIP-04/NIP-44 encryption/decryption.
2. **Web of Trust Distance Checker** -- Maintains a local social graph from Nostr kind:3 (contact list) events and provides hop-distance and trust-score queries via `window.nostr.wot`.

The extension targets Chrome and Firefox, using a service worker on Chrome and a background script on Firefox (declared side by side in `manifest.json`).

**Build system**: Vite + `@crxjs/vite-plugin`. All source is TypeScript (`.ts`/`.tsx`), compiled to JavaScript at build time. React JSX is used for popup, onboarding, and prompt UIs.

**TypeScript configuration**: `strict` mode, ES2022 target, `moduleResolution: bundler`, `jsx: react-jsx`. Path aliases: `@assets`, `@shared`, `@components`, `@lib`.

Cross-browser compatibility is handled by a thin shim at `lib/browser.ts`:

```ts
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
export default browserAPI;
```

Firefox natively supports the `browser.*` API; Chrome uses the `chrome.*` API. All other modules import from `lib/browser.ts` to stay portable.

---

## 2. Extension Architecture

### 2.1 Background Script -- `background.ts`

The central coordinator. Runs as a **service worker** on Chrome and a **persistent background script** on Firefox (both declared in `manifest.json` via `"service_worker"` and `"scripts"` fields respectively, with `"type": "module"`).

Responsibilities:
- All business logic: graph queries, sync orchestration, trust scoring, vault lifecycle, account management, NIP-07 signing coordination, profile metadata fetching, activity logging.
- Message handler: `browser.runtime.onMessage.addListener` receives messages from content scripts and extension pages, dispatches to `handleRequest()`.
- Auto-injection: `content.ts` and `inject.ts` are declared as `content_scripts` in `manifest.json` (matching `<all_urls>`), so the browser handles injection automatically. The background additionally uses `browser.scripting.executeScript` to inject the badge engine and CSS into tabs that have WoT badges enabled.
- On `runtime.onInstalled` (reason `install`), opens the onboarding wizard if no vault exists.

### 2.2 Content Script -- `content.ts`

Runs in the **ISOLATED** world. Acts as a bidirectional message bridge between the page context (`inject.ts`) and the background script.

- Listens for `window.postMessage` events with `type: 'WOT_REQUEST'` or `type: 'NIP07_REQUEST'`.
- Validates the method name against hardcoded allowlists (`WOT_ALLOWED_METHODS`, `NIP07_ALLOWED_METHODS`).
- Forwards valid requests to the background via `browser.runtime.sendMessage`.
- Posts responses back to the page as `WOT_RESPONSE` or `NIP07_RESPONSE`.
- **Rate limiter**: 100 WoT requests per second (sliding window, separate from the background rate limiter).
- **HTTPS enforcement**: NIP-07 methods are blocked on `http:` origins except `localhost`, `127.0.0.1`, and `[::1]`.
- **NIP-07 prefixing**: Adds `nip07_` prefix and `origin` (hostname) to all NIP-07 requests before forwarding.
- Guards against double injection with `window.__nostrWotContentInjected`.

### 2.3 Inject Script -- `inject.ts`

Runs in the **MAIN** world (page context). Written as an IIFE with `export {}` for module context. Bundled by Vite into a single script.

Exposes two API surfaces on the page:

- `window.nostr.getPublicKey()`, `window.nostr.signEvent(event)`, `window.nostr.getRelays()`, `window.nostr.nip04.{encrypt,decrypt}`, `window.nostr.nip44.{encrypt,decrypt}` -- NIP-07 signer.
- `window.nostr.wot.{getDistance, isInMyWoT, getTrustScore, getDetails, getConfig, getDistanceBatch, getTrustScoreBatch, filterByWoT, getStatus, getFollows, getCommonFollows, getStats, getPath}` -- Web of Trust API.

Each method posts a typed message to `window.postMessage` and returns a Promise that resolves when the matching response arrives. Timeouts: 30 seconds for WoT calls, 120 seconds for NIP-07 calls (users may need time to respond to signing prompts).

Fires a `CustomEvent('nostr-wot-ready')` on `window` when injection completes so pages can detect API availability.

### 2.4 Popup -- `src/popup/`

Extension popup UI opened when clicking the toolbar icon. React-based with CSS modules.

| File | Purpose |
|------|---------|
| `src/popup/index.html` | Entry point |
| `src/popup/main.tsx` | React app mount |
| `src/popup/PopupApp.tsx` | Root component with tab navigation, overlays, context providers |
| `src/popup/components/` | Feature components: Home, Settings, Approval, Vault, Wizard, etc. |
| `src/popup/context/` | React contexts: AccountContext, VaultContext, PermissionsContext, ScoringContext |

### 2.5 Onboarding -- `src/onboarding/`

First-run wizard opened on `runtime.onInstalled` if no vault exists. Guides users through account creation (generate, import nsec, import npub, NIP-46 bunker).

| File | Purpose |
|------|---------|
| `src/onboarding/index.html` | Entry point |
| `src/onboarding/main.tsx` | React app mount |
| `src/onboarding/OnboardingApp.tsx` | Multi-step wizard with state machine |

### 2.6 Prompt -- `src/prompt/`

Signing request approval popup. The signer queues pending requests in `browser.storage.session` and the popup overlay shows them with approve/deny buttons.

| File | Purpose |
|------|---------|
| `src/prompt/index.html` | Entry point |
| `src/prompt/main.tsx` | React app mount |
| `src/prompt/PromptApp.tsx` | Reads pending requests, sends decisions via RPC |

---

## 3. Manifest and Permissions

From `manifest.json` (MV3):

```json
{
    "manifest_version": 3,
    "permissions": ["storage", "scripting", "activeTab"],
    "optional_permissions": ["notifications"],
    "optional_host_permissions": ["<all_urls>"],
    "background": {
        "scripts": ["background.ts"],
        "service_worker": "background.ts",
        "type": "module"
    },
    "content_scripts": [
        { "matches": ["<all_urls>"], "js": ["content.ts"], "run_at": "document_start" },
        { "matches": ["<all_urls>"], "js": ["inject.ts"], "run_at": "document_start", "world": "MAIN" }
    ],
    "web_accessible_resources": [{
        "resources": ["icons/icon-base.svg", "locales/*.json", "badges/engine.ts", "badges/badges.css"],
        "matches": ["<all_urls>"]
    }]
}
```

Firefox-specific settings:
```json
{
    "gecko": {
        "id": "nostr-wot@dandelionlabs.io",
        "strict_min_version": "128.0"
    }
}
```

### Permission Model

- **Required**: `storage` (IndexedDB, browser.storage), `scripting` (inject content/page scripts), `activeTab` (current tab access).
- **Optional**: `notifications` (not currently used), `<all_urls>` (auto-injection on all sites).
- **Per-domain**: Users can grant injection permission for specific domains via `enableForCurrentDomain()`, which requests `*://{domain}/*` host permission and adds the domain to an `allowedDomains` list in `browser.storage.local`.

---

## 4. Type System -- `lib/types.ts`

Central type definitions shared across all modules:

| Type | Purpose |
|------|---------|
| `UnsignedEvent` | Nostr event before signing: `{ kind, created_at, tags, content }` |
| `SignedEvent` | Nostr event with `id`, `pubkey`, `sig` |
| `Account` | Storage format: `{ id, name, type, pubkey, privkey, mnemonic, nip46Config, readOnly, createdAt }` |
| `SafeAccount` | Account without `privkey` or `mnemonic` (for public APIs) |
| `MemoryAccount` | In-memory format: replaces `privkey: string` with `privkeyBytes: Uint8Array`, `mnemonic: string` with `mnemonicBytes: Uint8Array` |
| `MemoryVaultPayload` | `{ accounts: MemoryAccount[], activeAccountId: string \| null }` |
| `VaultPayload` | Storage/JSON format: `{ accounts: Account[], activeAccountId: string \| null }` |
| `PendingRequest` | Signer queue entry: `{ id, type, origin, accountId, timestamp, waitingForUnlock?, needsPermission?, nip46InFlight? }` |
| `RequestDecision` | `{ allow: boolean, remember?: boolean, rememberKind?: boolean, reason?: string }` |
| `PermissionDecision` | `'allow' \| 'deny' \| 'ask'` |
| `AccountType` | `'generated' \| 'nsec' \| 'npub' \| 'nip46' \| 'external'` |
