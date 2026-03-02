# Message Flow

## 1. Page-to-Background Round Trip

```
inject.ts (MAIN world)
  |  window.postMessage({ type: 'WOT_REQUEST' | 'NIP07_REQUEST', id, method, params })
  v
content.ts (ISOLATED world)
  |  1. Rate-limit check (100 WoT req/sec)
  |  2. Validate method against allowlist
  |  3. For NIP-07: enforce HTTPS, prefix method with 'nip07_', append origin
  |  4. browser.runtime.sendMessage({ method, params })
  v
background.ts (service worker)
  |  1. Privilege gate (block privileged methods from content scripts)
  |  2. validateNip07Params (event shape, pubkey format)
  |  3. handleRequest() -> switch on method -> return result
  v
content.ts
  |  window.postMessage({ type: 'WOT_RESPONSE' | 'NIP07_RESPONSE', id, result, error })
  v
inject.ts
     Promise resolves with result
```

---

## 2. NIP-07 Method Prefixing

When `content.ts` forwards a NIP-07 request, it transforms:
- `method: 'signEvent'` becomes `method: 'nip07_signEvent'`
- `params` gets `origin: window.location.hostname` merged in (via object spread, no mutation)

This allows `background.ts` to distinguish page-origin NIP-07 calls from internal extension calls.

---

## 3. Rate Limiting

Two layers:

| Layer | Location | Limit |
|-------|----------|-------|
| Content script | `content.ts` | 100 WoT req/sec (sliding window) |
| Background | `background.ts` | 50 req/sec per method (sliding window) |

The background rate limiter covers WoT computation methods only (`getDistance`, `getTrustScore`, `getDistanceBatch`, etc.). NIP-07 methods are not rate-limited at this layer -- they are gated by the user-facing permission system instead.

---

## 4. HTTPS Enforcement

NIP-07 methods are blocked on `http:` origins, preventing key material from being exposed over insecure connections. Exceptions: `localhost`, `127.0.0.1`, and `[::1]` (local development). The check uses exact string matching -- `localhost.evil.com` is **not** exempted.

---

## 5. Privileged Methods

Methods in `PRIVILEGED_METHODS` are gated to internal extension senders only. The check:

```ts
const isInternal = sender.id === browser.runtime.id &&
  (!sender.url || sender.url.startsWith(extensionBaseUrl));
```

This ensures the message comes from an extension page (popup, onboarding, prompt) and not from a content script running in a web page tab. This protects all vault, permission, database management, sync, and configuration methods.

---

## 6. Channel Isolation

The three message channels are strictly separated:
- **WoT channel** (`WOT_REQUEST`/`WOT_RESPONSE`) -- can only access `WOT_ALLOWED_METHODS`
- **NIP-07 channel** (`NIP07_REQUEST`/`NIP07_RESPONSE`) -- can only access `NIP07_ALLOWED_METHODS`
- **Internal channel** (direct `browser.runtime.sendMessage`) -- can access privileged methods

A WoT request cannot invoke NIP-07 methods and vice versa. Neither can invoke privileged methods.
