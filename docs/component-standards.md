# Component Standards

Guidelines for shared components, hooks, and utilities in the Nostr WoT Extension.

---

## 1. Shared Component Inventory

All shared components live in `src/components/`, each in its own folder.

| Component | Props | Description |
|-----------|-------|-------------|
| Button | `variant`, `small`, `className`, `children`, `...rest` | Primary/secondary/danger button with optional small size |
| Card | `className`, `children`, `...rest` | Card container wrapper |
| ChipGroup | `options`, `value`, `onChange`, `className` | Toggle chip group; options: `{ value, label }[]` |
| EmptyState | `icon`, `text`, `hint`, `children`, `className` | Centered empty state placeholder |
| FieldDisplay | `label`, `value`, `mono`, `className` | Read-only label + value pair |
| Input | `type`, `mono`, `showToggle`, `label`, `error`, `className`, `...rest` | Text/password input with optional toggle |
| InputRow | `value`, `onChange`, `placeholder`, `onSubmit`, `buttonLabel`, `disabled`, `error`, `mono`, `className` | Inline input + submit button + error |
| ModeCard | `active`, `label`, `desc`, `onClick`, `className` | Radio-style selectable card |
| NavItem | `icon`, `label`, `desc`, `onClick`, `className` | Navigation row with icon and chevron |
| PulseLogo | `src`, `size`, `alt`, `className` | Logo with pulse animation |
| Select | `options`, `value`, `onChange`, `small`, `className`, `...rest` | Dropdown select |
| Splash | `visible`, `onTransitionEnd` | Full-screen splash with fade-out |
| StatusDot | `status`, `className` | Colored status indicator dot |
| Toggle | `checked`, `onChange`, `...rest` | Toggle switch |
| TopoBg | `className`, `children` | Topographic pattern background |

---

## 2. When to Extract

Extract a component when:

- It is used (or will be used) in **2+ places**.
- It encapsulates a discrete UI pattern (e.g., an input row, a toggle, a card).
- It has clear props and no tight coupling to parent state.

Do **not** extract if:
- The component only makes sense in one context.
- Extracting would require passing many parent-specific callbacks through props.

---

## 3. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Folder | PascalCase | `src/components/ChipGroup/` |
| Component file | PascalCase `.tsx` | `ChipGroup.tsx` |
| CSS Module | Same name `.module.css` | `ChipGroup.module.css` |
| Hook file | camelCase `use` prefix `.ts` | `useVaultUnlock.ts` |
| Utility file | camelCase `.ts` | `activity.ts` |

---

## 4. CSS Patterns

- **CSS Modules only** — every component co-locates a `.module.css` file.
- **camelCase class names** — e.g., `chipGroup`, `chipActive` (not `chip-group`).
- **No global styles** in shared components. Use CSS variables (`var(--brand)`, `var(--card-bg)`, etc.) from the theme.
- **Transitions** — keep to `0.15s` for consistency.
- **Avoid `!important`** — specificity via module scoping is sufficient.

---

## 5. Hooks

All shared hooks live in `src/shared/hooks/`, one hook per file.

| Hook | Purpose |
|------|---------|
| `useBrowserStorage(key, default, area)` | Read/write `browser.storage` with live change listener |
| `useRpc<T>(method, params, opts)` | Call background RPC on mount, with reload/loading/error (generic) |
| `useVaultUnlock({ onSuccess })` | Password state, unlock RPC, error handling, input ref |
| `useAnimatedVisible(visible)` | Manages mount/unmount transitions for overlays |
| `useWizardFlow()` | State machine hook for onboarding wizard |

### Hook guidelines

- Always return objects (not arrays) when returning 3+ values — allows destructuring by name.
- Keep hooks focused on one concern.
- Prefix with `use`.

---

## 6. Shared Utilities

All shared utilities live in `src/shared/`, one concern per file.

| File | Exports |
|------|---------|
| `rpc.ts` | `rpc<T>()`, `rpcNotify()`, `RpcError` |
| `format/` | `truncateNpub`, `getInitial`, `formatTimeAgo`, `formatBytes`, `toPercent`, `toFraction` |
| `permissions.ts` | `formatPermMethod` |
| `url.ts` | `getDomainFromUrl` |
| `activity.ts` | `groupActivityEntries` |
| `constants.ts` | `AUTO_LOCK_OPTIONS`, `SENSITIVITY_PRESETS`, `DEFAULT_RELAYS`, `KNOWN_ORACLES`, etc. |
| `browser.ts` | Browser detection and API utilities for UI code |
| `clientIcons.ts` | Known Nostr client icon mappings |
| `adapterDefaults.ts` | Default WoT badge adapter configurations |
| `blossom.ts` | Blossom media upload utilities |
| `wizardMachine.ts` | Onboarding wizard state machine |

---

## 7. Import Aliases

Configured in `vite.config.ts`:

| Alias | Path |
|-------|------|
| `@components` | `src/components` |
| `@shared` | `src/shared` |
| `@lib` | `lib` |
| `@assets` | `src/assets` |

Always use aliases instead of relative paths when crossing module boundaries.

---

## 8. RPC Convention

**Never** use raw `browser.runtime.sendMessage` in UI code. Use the typed RPC layer:

| Function | Use case |
|----------|----------|
| `rpc(method, params)` | Request/response — returns result or throws `RpcError` |
| `rpcNotify(method, params)` | Fire-and-forget notifications (e.g., `configUpdated`) |
| `useRpc(method, params, opts)` | React hook for loading data on mount |

This ensures consistent error handling, type narrowing, and makes it easy to find all RPC call sites.
