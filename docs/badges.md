# WoT Badge Injection -- `badges/`

Visual trust badges injected into Nostr web client pages.

## 1. Architecture

- `badges/engine.ts` -- MAIN world IIFE, runs alongside the page's JavaScript
- `badges/badges.css` -- base badge styles, injected via `browser.scripting.insertCSS`
- `src/shared/adapterDefaults.ts` -- built-in adapter strategies per domain + config normalization
- Controlled by the `wotInjectionEnabled` flag in `browser.storage.sync` (default: on)
- Per-domain disable via `badgeDisabledSites` in `browser.storage.local`

---

## 2. Config-Driven Adapters

Adapters are **not** hardcoded in the engine. Instead, `background.ts` builds an effective config object and injects it into the page as `window.__wotCustomAdapters` before the engine runs.

### Config flow

1. `background.ts` reads per-domain adapter config from `browser.storage.local` (key: `wotBadgeAdapters`)
2. If no user config exists for a domain, `getDefaultsForDomain(domain)` provides built-in defaults from `adapterDefaults.ts`
3. User custom CSS is sanitized (no `url()`, `@import`, `expression()`, etc.)
4. The merged config is injected into the page via `browser.scripting.executeScript` setting `window.__wotCustomAdapters`
5. The engine reads this config on init and builds runtime adapters

### Adapter config structure (v2)

```ts
{
  version: 2,
  strategies: [
    {
      label: 'Profile dot',          // human-readable label for UI
      selectors: '[data-user]',      // CSS selectors (newline-separated for multiple)
      extractFrom: 'data-user',      // 'href' | 'text' | 'data-{attr}'
      insertPosition: 'append',      // 'after' | 'before' | 'append'
      displayMode: 'score',          // optional: 'score' shows percentage text
      customCSS: '.wot-badge { ... }', // per-strategy CSS overrides
      conflictGroup: 'profileBadge', // optional: strategies in same group are mutually exclusive
      enabled: true                  // toggle individual strategies
    }
  ]
}
```

### Built-in defaults

| Domain | Strategies |
|--------|-----------|
| `primal.net` | Profile dot, Score dot (disabled by default), Avatar ring, Data attributes |
| `snort.social` | Profile links |
| `nostrudel` | Profile links |
| `coracle` | Profile links |
| `iris.to` | Profile links |
| (any other) | Generic: `a[href*="npub1"]`, `[data-npub]`, `[data-pubkey]` |

---

## 3. Detection & Scanning

1. On init, the engine builds runtime adapters from `window.__wotCustomAdapters` for the current hostname
2. `MutationObserver` detects new DOM nodes (handles SPA navigation, infinite scroll)
3. Scan debounced to 300ms to avoid excessive processing
4. Elements matched against adapter selectors, pubkeys extracted
5. **Pubkey normalization**: accepts both `npub1...` and 64-char hex pubkeys
6. **Bech32 validation**: all npubs are verified with full bech32 checksum (prevents crafted strings)
7. Elements are marked per-strategy (`data-wot-s0`, `data-wot-s1`, ...) to prevent duplicate badges

---

## 4. Batching & Rendering

1. Pubkeys batched (50 max, 500ms interval) and queried via `window.nostr.wot.getDistanceBatch`
2. Results cached in `wotCache: Map<npub, BadgeData>` (subsequent scans skip the API call)
3. Background normalizes npub->hex, queries precomputed BFS cache (O(1))
4. Badge element created with dot + optional score text
5. Mutation observer paused during badge insertion to prevent feedback loops

---

## 5. Score-Based Color Gradient

Badges use a **continuous color gradient** based on trust score, not fixed hop-based colors:

| Score | Color | Hex |
|-------|-------|-----|
| 0% | Gray | `#6b7280` |
| 50% | Orange | `#f59e0b` |
| 65% | Yellow | `#eab308` |
| 70% | Green | `#22c55e` |
| 100% | Light blue | `#38bdf8` |

Intermediate scores interpolate linearly between stops.

Special cases:
- **Not in graph** (`hops === null`): class `wot-not-in-graph`
- **Self** (`hops === 0`): attribute `data-hops="0"`
- **Stale graph** (>24h since last sync): class `wot-stale`

---

## 6. Display Modes

| Mode | What's shown |
|------|-------------|
| (default) | Colored dot only |
| `score` | Colored dot + percentage text (e.g., "72%", "You", "?") |

---

## 7. Tooltip

Hovering a badge shows a tooltip with:
- **Distance**: hop count (or "You" for self)
- **Paths**: number of shortest paths
- **Trust score**: percentage
- **Staleness warning**: if graph is >24h old

All tooltip text is set via `textContent` (never `innerHTML`) for security.

---

## 8. Refresh & Reinit

The engine exposes two global functions for config changes:

- `window.__wotRefreshBadges()` -- light refresh: clears badges, rescans with same adapters
- `window.__wotReinitBadges()` -- full reinit: rebuilds adapters from `window.__wotCustomAdapters`, then rescans

`background.ts` calls these after user changes adapter settings in the popup.

---

## 9. Adding Site Support

See [Adding Badge Support](add_badge.md) for how to add or customize badge adapters for a site.
