/**
 * Built-in adapter defaults and config normalization.
 *
 * Shared between the popup UI (ESM import) and referenced by engine.js (inline copy of normalizeConfig).
 * If you change normalizeConfig here, update the inline copy in engine.js too.
 */

// ── Types ──

export interface AdapterStrategy {
  label: string;
  selectors: string;
  extractFrom: string;
  insertPosition: string;
  customCSS: string;
  displayMode?: string;
  conflictGroup?: string;
  enabled?: boolean;
}

export interface AdapterConfigV2 {
  version: 2;
  strategies: AdapterStrategy[];
  customCSS?: string;
}

export interface AdapterConfigV1 {
  version?: number;
  selectors?: string;
  extractFrom?: string;
  insertPosition?: string;
  customCSS?: string;
}

export type AdapterConfig = AdapterConfigV2 | AdapterConfigV1;

export interface CommonSelector {
  label: string;
  value: string;
}

// ── Default strategies per domain (extracted from built-in adapters) ──

const BUILTIN_ADAPTER_DEFAULTS: Record<string, AdapterStrategy[]> = {
  'primal.net': [
    {
      label: 'Profile dot',
      selectors: '[data-user]:not([class*="verificationIcon"]):not([class*="nanoAvatar"]):not([class*="directMessageContact"])',
      extractFrom: 'data-user',
      insertPosition: 'append',
      conflictGroup: 'profileBadge',
      customCSS: [
        '.wot-badge {',
        '  position: absolute;',
        '  display: inline-flex;',
        '  bottom: 0;',
        '  right: 0;',
        '}',
      ].join('\n'),
    },
    {
      label: 'Score dot',
      selectors: '[data-user]:not([class*="verificationIcon"]):not([class*="nanoAvatar"]):not([class*="directMessageContact"])',
      extractFrom: 'data-user',
      insertPosition: 'append',
      displayMode: 'score',
      conflictGroup: 'profileBadge',
      enabled: false,
      customCSS: [
        '.wot-badge {',
        '  position: relative;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 3px;',
        '  bottom: auto;',
        '  right: auto;',
        '  margin-left: 6px;',
        '  vertical-align: middle;',
        '  padding: 1px 6px 1px 4px;',
        '  border-radius: 8px;',
        '  background: rgba(128, 128, 128, 0.12);',
        '}',
        '.wot-badge .wot-badge-dot {',
        '  width: 6px;',
        '  height: 6px;',
        '  border-width: 1px;',
        '}',
      ].join('\n'),
    },
    {
      label: 'Avatar ring',
      selectors: '[data-user]:not([class*="verificationIcon"]):not([class*="directMessageContact"])',
      extractFrom: 'data-user',
      insertPosition: 'append',
      customCSS: [
        '/* Ring around avatar */',
        '[data-user] > .wot-badge {',
        '  inset: -3px;',
        '  border-radius: 50%;',
        '  pointer-events: none;',
        '}',
        '[data-user] > .wot-badge > .wot-badge-dot {',
        '  position: absolute;',
        '  inset: 0;',
        '  width: auto;',
        '  height: auto;',
        '  border: none;',
        '  border-radius: 50%;',
        '  box-shadow: none !important;',
        '  -webkit-mask: radial-gradient(circle closest-side, transparent calc(100% - 3px), black calc(100% - 2px));',
        '  mask: radial-gradient(circle closest-side, transparent calc(100% - 3px), black calc(100% - 2px));',
        '}',
        '[data-user] > .wot-badge:hover > .wot-badge-dot {',
        '  transform: none;',
        '}',
      ].join('\n'),
    },
    { label: 'Data attributes', selectors: '[data-npub]', extractFrom: 'data-npub', insertPosition: 'append', customCSS: '' },
  ],
  'snort.social': [
    { label: 'Profile links', selectors: 'a[href*="/p/npub"]\na[href*="/p/"]\na[href*="npub1"]', extractFrom: 'href', insertPosition: 'after', customCSS: '' },
  ],
  'nostrudel': [
    { label: 'Profile links', selectors: 'a[href*="/u/npub"]\na[href*="npub1"]', extractFrom: 'href', insertPosition: 'after', customCSS: '' },
  ],
  'coracle': [
    { label: 'Profile links', selectors: 'a[href*="/people/npub"]\na[href*="npub1"]', extractFrom: 'href', insertPosition: 'after', customCSS: '' },
  ],
  'iris.to': [
    { label: 'Profile links', selectors: 'a[href*="/npub"]\na[href*="npub1"]', extractFrom: 'href', insertPosition: 'after', customCSS: '' },
  ],
};

const GENERIC_DEFAULTS: AdapterStrategy[] = [
  { label: 'Links & data attributes', selectors: 'a[href*="npub1"]\n[data-npub]\n[data-pubkey]', extractFrom: 'href', insertPosition: 'after', customCSS: '' },
];

// ── CSS skeleton template ──

const CSS_SKELETON = `/* Badge dot */
.wot-badge {
  /* position: absolute; bottom: -2px; right: -2px; */
}

.wot-badge-dot {
  /* width: 10px; height: 10px; border-radius: 50%; */
}

/* Tooltip */
.wot-tooltip {
  /* background: #1e1e2e; border-radius: 8px; padding: 8px 12px; */
}

.wot-tooltip-row {
  /* display: flex; justify-content: space-between; gap: 12px; */
}

.wot-tooltip-label {
  /* color: #a1a1aa; font-size: 11px; */
}

.wot-tooltip-value {
  /* color: #fff; font-size: 11px; font-weight: 600; */
}`;

// ── Domain matcher ──

export function getDefaultsForDomain(domain: string): AdapterStrategy[] {
  // Exact match
  if (BUILTIN_ADAPTER_DEFAULTS[domain]) {
    return structuredClone(BUILTIN_ADAPTER_DEFAULTS[domain]);
  }
  // Partial match (e.g. "app.primal.net" matches "primal.net")
  for (const [pattern, strategies] of Object.entries(BUILTIN_ADAPTER_DEFAULTS)) {
    if (domain.includes(pattern)) {
      return structuredClone(strategies);
    }
  }
  // Fallback
  return structuredClone(GENERIC_DEFAULTS);
}

// ── Config normalization (v1 -> v2) ──

export function normalizeConfig(cfg: AdapterConfig | null | undefined): AdapterConfigV2 {
  if (!cfg) return { version: 2, strategies: [] };

  // Already v2
  if ((cfg as AdapterConfigV2).version === 2 && Array.isArray((cfg as AdapterConfigV2).strategies)) {
    const v2 = cfg as AdapterConfigV2;
    // Migrate top-level customCSS into first strategy if present
    if (v2.customCSS && v2.strategies.length > 0 && !v2.strategies.some(s => s.customCSS)) {
      v2.strategies[0].customCSS = v2.customCSS;
    }
    // Ensure every strategy has a customCSS field
    for (const s of v2.strategies) {
      if (s.customCSS == null) s.customCSS = '';
    }
    return v2;
  }

  // v1 -> v2 migration
  const v1 = cfg as AdapterConfigV1;
  const strategies: AdapterStrategy[] = [];
  if (v1.selectors || v1.extractFrom || v1.insertPosition) {
    strategies.push({
      label: '',
      selectors: v1.selectors || '',
      extractFrom: v1.extractFrom || 'href',
      insertPosition: v1.insertPosition || 'after',
      customCSS: v1.customCSS || '',
    });
  }

  return {
    version: 2,
    strategies,
  };
}

export const COMMON_SELECTORS: readonly CommonSelector[] = [
  { label: 'npub links', value: 'a[href*="npub1"]' },
  { label: 'Profile (/p/)', value: 'a[href*="/p/npub"]' },
  { label: 'Profile (/profile/)', value: 'a[href*="/profile/npub"]' },
  { label: 'data-npub', value: '[data-npub]' },
  { label: 'data-pubkey', value: '[data-pubkey]' },
  { label: 'data-user', value: '[data-user]' },
  { label: 'data-user (no badges)', value: '[data-user]:not([class*="verificationIcon"])' },
] as const;

export { BUILTIN_ADAPTER_DEFAULTS, GENERIC_DEFAULTS, CSS_SKELETON };
