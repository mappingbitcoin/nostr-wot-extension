# Adding WoT Badge Support for a New Website

This guide explains how to add Web of Trust badge injection support for a Nostr web client -- either as an end user via the popup UI, or as a contributor adding built-in defaults.

## How Badge Injection Works

The badge engine (`badges/engine.ts`) is config-driven. It receives adapter configs from the background script via `window.__wotCustomAdapters` and:

1. **Builds runtime adapters** from the config for the current hostname
2. **Scans the DOM** for elements matching each strategy's CSS selectors
3. **Extracts pubkeys** (npub or 64-char hex) from matched elements
4. **Validates pubkeys** with bech32 checksum verification
5. **Queries the WoT API** in batch (up to 50 pubkeys, 500ms interval) for trust scores
6. **Renders badges** with score-based color gradient and optional percentage text
7. **Watches for DOM changes** via MutationObserver to catch dynamically loaded content

## Badge Visual States

Badges use a continuous color gradient based on trust score:

| Score | Color |
|-------|-------|
| 0% | Gray |
| 50% | Orange |
| 65% | Yellow |
| 70%+ | Green |
| 100% | Light blue |

Special states:
- **Not in graph**: muted style (class `wot-not-in-graph`)
- **Self** (your own pubkey): attribute `data-hops="0"`
- **Stale graph** (>24h): dimmed with tooltip warning

Hovering a badge shows a tooltip with distance (hops), path count, trust score, and staleness warning.

## Strategy Config

Each domain can have multiple **strategies** -- independent rules for finding and badging elements. A strategy has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Human-readable name (e.g., "Profile dot", "Avatar ring") |
| `selectors` | string | CSS selectors, one per line. Engine runs `querySelectorAll` for each |
| `extractFrom` | string | Where to find the pubkey: `href`, `text`, or `data-{attr}` (e.g., `data-npub`, `data-user`) |
| `insertPosition` | string | Badge placement: `after` (most common), `before`, or `append` (inside element) |
| `displayMode` | string? | Optional. Set to `score` to show percentage text next to the dot |
| `customCSS` | string? | Per-strategy CSS overrides for `.wot-badge`, `.wot-badge-dot`, etc. |
| `conflictGroup` | string? | Strategies in the same group are mutually exclusive in the UI |
| `enabled` | boolean? | Toggle individual strategies (default: `true`) |

### Full config structure (v2)

```json
{
  "version": 2,
  "strategies": [
    {
      "label": "Profile links",
      "selectors": "a[href*=\"/p/npub\"]\na[href*=\"npub1\"]",
      "extractFrom": "href",
      "insertPosition": "after",
      "customCSS": ""
    }
  ]
}
```

## Option A: Configure via Popup UI (End Users)

1. Open the extension popup
2. Open the **Settings** menu (gear icon in the top bar)
3. Go to **Web of Trust** > **Badges**
4. Click the site you want to configure (must already be a connected site)
5. Click **+ Add Strategy** and choose a template or "Custom"
6. Configure:
   - **CSS Selectors**: inspect the site with DevTools to find profile elements
   - **Extract From**: where the pubkey appears (href, data attribute, text)
   - **Badge Placement**: where to insert the badge relative to the element
   - **Custom CSS**: optional styling overrides
7. Click **Save** -- badges refresh immediately on the page
8. Use **Preview** to test changes without leaving the editor

The UI provides common selector presets (npub links, data-npub, data-pubkey, data-user) and a CSS skeleton template.

## Option B: Add Built-in Defaults (Contributors)

Built-in defaults live in `src/shared/adapterDefaults.ts`. When a user connects to a site with no custom config, the engine uses these defaults.

### Step 1: Inspect the target site

Open the Nostr client in DevTools (F12) and find:

1. Elements that display usernames or profile links
2. The CSS selector pattern (tag, classes, href patterns, data attributes)
3. Where the npub/pubkey appears (in href, data attribute, text)
4. Where the badge should visually appear (after link, appended inside, etc.)

### Step 2: Add the default strategies

Edit `src/shared/adapterDefaults.ts` and add an entry to `BUILTIN_ADAPTER_DEFAULTS`:

```ts
const BUILTIN_ADAPTER_DEFAULTS: Record<string, AdapterStrategy[]> = {
  // ... existing entries ...

  'mynewsite.com': [
    {
      label: 'Profile links',
      selectors: 'a[href*="/profile/npub"]\na[href*="npub1"]',
      extractFrom: 'href',
      insertPosition: 'after',
      customCSS: '',
    },
  ],
};
```

**Key considerations:**

- The domain key uses partial matching (`hostname.includes(domain)`), so `'primal.net'` matches `app.primal.net`
- Multiple strategies per domain are supported -- use them for different badge styles (dot, score, ring)
- Set `enabled: false` on alternative strategies that users can opt into
- Use `conflictGroup` to mark strategies that shouldn't both be active (e.g., "Profile dot" vs "Score dot")
- Keep `customCSS` minimal -- only override when the default badge styles don't work with the site's layout

### Step 3: Test

1. Build the extension: `npm run build`
2. Load it in your browser (`chrome://extensions` > "Load unpacked")
3. Navigate to the target site and connect it (popup > Home > enable for site)
4. Verify:
   - Badges appear next to profile elements
   - Colors reflect trust scores
   - Tooltips show on hover
   - New elements get badges when scrolling / navigating (MutationObserver)
   - No visual glitches or layout shifts
5. Test with the UI: open Settings > Web of Trust > Badges > click the site > verify strategies appear

### Step 4: Submit a Pull Request

Your PR should:
1. Add the strategy entries in `src/shared/adapterDefaults.ts`
2. Include screenshots of the badges on the target site
3. Note any site-specific quirks (e.g., "uses data-user attribute with hex pubkeys")

## Pubkey Extraction Modes

| Mode | How it works | Use when |
|------|-------------|----------|
| `href` | Regex match `npub1[bech32]{58}` from element's `href` attribute | Links with npub in URL |
| `data-{attr}` | Read from `element.dataset[attr]` | Site stores pubkey in data attributes |
| `text` | Regex match from `element.textContent` | Pubkey is displayed as visible text |

The engine normalizes both npub and 64-char hex pubkeys. All npubs are validated with full bech32 checksum verification.

## Custom CSS Reference

Per-strategy CSS is scoped with `[data-wot-strategy="N"]` where N is the strategy index. Main classes:

```css
.wot-badge { }           /* Container span */
.wot-badge-dot { }       /* Colored dot */
.wot-badge-text { }      /* Score text (score display mode only) */
.wot-not-in-graph { }    /* Not in trust graph */
.wot-stale { }           /* Graph is >24h old */
.wot-tooltip { }         /* Hover tooltip */
```

See `badges/badges.css` for the full default stylesheet.

## Existing Built-in Adapters

| Domain | Strategies | Notes |
|--------|-----------|-------|
| `primal.net` | Profile dot, Score dot, Avatar ring, Data attributes | Uses `data-user` with hex pubkeys |
| `snort.social` | Profile links | Standard npub href links |
| `nostrudel` | Profile links | Standard npub href links |
| `coracle` | Profile links | Standard npub href links |
| `iris.to` | Profile links | Standard npub href links |
| (any other) | Generic fallback | `a[href*="npub1"]`, `[data-npub]`, `[data-pubkey]` |
