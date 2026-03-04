/**
 * WoT Badge Engine — core injection logic
 *
 * Runs in MAIN world. Config is provided via window.__wotCustomAdapters
 * (injected by background.js from user settings or built-in defaults).
 * Observes DOM, finds profile elements, queries window.nostr.wot, renders badges.
 *
 * Security: all extracted npub values are validated with bech32 checksum verification
 * before being sent to the WoT API. Badge text is set via textContent (never innerHTML
 * with untrusted data). No user-controlled strings are inserted as HTML.
 */

export {}; // make this a module for declare global

interface BadgeData {
    hops: number | null;
    paths: number | null;
    score: number | null;
}

interface ColorStop {
    score: number;
    r: number;
    g: number;
    b: number;
}

interface BadgeAdapter {
    name: string;
    strategyIdx: number | null;
    displayMode: string | null;
    match: (hostname: string) => boolean;
    selectors: string[];
    extractPubkey: (el: Element) => string | null;
    insertBadge: (el: Element, badge: HTMLElement) => void;
}

interface QueueItem {
    el: Element;
    adapter: BadgeAdapter;
}

interface StrategyConfig {
    label?: string;
    selectors: string;
    extractFrom?: string;
    insertPosition?: string;
    customCSS?: string;
    displayMode?: string;
    enabled?: boolean;
}

interface AdapterConfig {
    version?: number;
    strategies?: StrategyConfig[];
    selectors?: string;
    extractFrom?: string;
    insertPosition?: string;
    customCSS?: string;
}

interface ScanWithAdapterFn {
    (adapter: BadgeAdapter, claimed: Set<string>): number;
    _idSeq: number;
}

/** Shape of window.nostr.wot as used by badge engine */
interface BadgeWotApi {
    getDistanceBatch: (targets: string[], options?: Record<string, boolean>) => Promise<Record<string, BadgeData | null> | Map<string, BadgeData | null>>;
    getStatus: () => Promise<{ configured: boolean } | null>;
    getStats: () => Promise<{ lastSync: number | null } | null>;
}

declare global {
    interface Window {
        __wotBadgeEngineRunning?: boolean;
        __wotBadgeObserver?: MutationObserver | null;
        __wotCustomAdapters?: Record<string, AdapterConfig>;
        __wotRefreshBadges?: () => void;
        __wotReinitBadges?: () => void;
    }
    interface Element {
        _wotId?: number;
    }
}

/** Helper to access the WoT API from the badge engine context */
function getWotApi(): BadgeWotApi | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (window as any).nostr?.wot;
}

(function () {
    'use strict';

    const LOG = (..._args: unknown[]) => {};
    const WARN = (..._args: unknown[]) => {};

    if (window.__wotBadgeEngineRunning) return;
    window.__wotBadgeEngineRunning = true;

    // ── Config ──

    const BATCH_INTERVAL = 500;
    const STALE_THRESHOLD = 86400000;
    const MAX_BATCH = 50;
    const BADGE_ATTR = 'data-wot-badge';
    const SCAN_DEBOUNCE = 300;

    // Strict npub format: exactly npub1 + 58 lowercase bech32 chars
    const NPUB_STRICT = /^npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;
    const NPUB_EXTRACT = /npub1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}/;

    // Bech32 checksum verification (prevents crafted strings from being accepted)
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

    function bech32Polymod(values: number[]): number {
        let chk = 1;
        for (const v of values) {
            const b = chk >> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (let i = 0; i < 5; i++) {
                if ((b >> i) & 1) chk ^= GEN[i];
            }
        }
        return chk;
    }

    function bech32HrpExpand(hrp: string): number[] {
        const ret: number[] = [];
        for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
        ret.push(0);
        for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
        return ret;
    }

    function verifyBech32Checksum(str: string): boolean {
        // Full bech32 checksum verification
        const sep = str.lastIndexOf('1');
        if (sep < 1 || sep + 7 > str.length) return false;
        const hrp = str.slice(0, sep);
        const data: number[] = [];
        for (let i = sep + 1; i < str.length; i++) {
            const c = CHARSET.indexOf(str[i]);
            if (c === -1) return false;
            data.push(c);
        }
        return bech32Polymod(bech32HrpExpand(hrp).concat(data)) === 1;
    }

    /**
     * Validate an npub string: format check + bech32 checksum.
     * Returns the npub if valid, null otherwise.
     * This prevents malicious sites from injecting crafted strings
     * that look like npubs but aren't valid bech32.
     */
    function validateNpub(candidate: string): string | null {
        if (!candidate || typeof candidate !== 'string') return null;
        if (!NPUB_STRICT.test(candidate)) return null;
        if (!verifyBech32Checksum(candidate)) return null;
        return candidate;
    }

    // ── Hex pubkey → npub conversion ──

    const HEX_PUBKEY = /^[0-9a-f]{64}$/;

    function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
        let acc = 0, bits = 0;
        const result: number[] = [], maxv = (1 << to) - 1;
        for (const v of data) {
            acc = (acc << from) | v;
            bits += from;
            while (bits >= to) { bits -= to; result.push((acc >> bits) & maxv); }
        }
        if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
        return result;
    }

    function bech32CreateChecksum(hrp: string, data: number[]): number[] {
        const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
        const mod = bech32Polymod(values) ^ 1;
        const result: number[] = [];
        for (let i = 0; i < 6; i++) result.push((mod >> (5 * (5 - i))) & 31);
        return result;
    }

    function hexToNpub(hex: string): string | null {
        const bytes: number[] = [];
        for (let i = 0; i < 64; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
        const data5 = convertBits(bytes, 8, 5, true);
        if (!data5) return null;
        const checksum = bech32CreateChecksum('npub', data5);
        let result = 'npub1';
        for (const d of data5.concat(checksum)) result += CHARSET[d];
        return result;
    }

    /**
     * Normalize any pubkey format to a validated npub.
     * Accepts npub1... (bech32-validated) or 64-char hex (converted to npub).
     */
    function normalizePubkey(raw: string | null): string | null {
        if (!raw || typeof raw !== 'string') return null;
        if (raw.startsWith('npub1')) return validateNpub(raw);
        if (HEX_PUBKEY.test(raw)) return hexToNpub(raw);
        return null;
    }

    // ── State ──

    let adapters: BadgeAdapter[] = [];
    let pendingPubkeys = new Map<string, QueueItem[]>();
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let scanTimer: ReturnType<typeof setTimeout> | null = null;
    let wotCache = new Map<string, BadgeData>();
    let graphStale = false;
    let started = false;
    let activeTooltip: HTMLElement | null = null;
    let mutationPaused = false; // suppress observer while we insert badges

    // ── Config normalization (inline — engine is IIFE, can't import) ──

    function normalizeConfig(cfg: AdapterConfig | null): { version: number; strategies: StrategyConfig[] } {
        if (!cfg) return { version: 2, strategies: [] };
        if (cfg.version === 2 && Array.isArray(cfg.strategies)) {
            if (cfg.customCSS && cfg.strategies.length > 0 && !cfg.strategies.some(s => s.customCSS)) {
                cfg.strategies[0].customCSS = cfg.customCSS;
            }
            for (const s of cfg.strategies) { if (s.customCSS == null) s.customCSS = ''; }
            return cfg as { version: number; strategies: StrategyConfig[] };
        }
        const strategies: StrategyConfig[] = [];
        if (cfg.selectors || cfg.extractFrom || cfg.insertPosition) {
            strategies.push({
                label: '',
                selectors: cfg.selectors || '',
                extractFrom: cfg.extractFrom || 'href',
                insertPosition: cfg.insertPosition || 'after',
                customCSS: cfg.customCSS || '',
            });
        }
        return { version: 2, strategies };
    }

    // ── Init ──

    // Build runtime adapters from a v2 config (one per strategy)
    function buildCustomAdapters(domain: string, rawCfg: AdapterConfig): BadgeAdapter[] {
        const cfg = normalizeConfig(rawCfg);
        return cfg.strategies
            .filter(s => (s.selectors || '').trim() && s.enabled !== false)
            .map((strategy, idx) => {
                const sels = strategy.selectors.split('\n').map(s => s.trim()).filter(Boolean);

                return {
                    name: 'custom:' + domain + ':' + idx,
                    strategyIdx: idx,
                    displayMode: strategy.displayMode || null,
                    match: (h: string) => h.includes(domain),
                    selectors: sels,
                    extractPubkey(el: Element): string | null {
                        const mode = strategy.extractFrom || 'href';
                        if (mode.startsWith('data-')) {
                            const attr = mode.slice(5);
                            return (el as HTMLElement).dataset?.[attr] || null;
                        }
                        if (mode === 'text') return (el.textContent?.match(NPUB_EXTRACT) || [])[0] || null;
                        return (el.getAttribute('href')?.match(NPUB_EXTRACT) || [])[0] || null;
                    },
                    insertBadge(el: Element, badge: HTMLElement) {
                        const pos = strategy.insertPosition || 'after';
                        if (pos === 'before') el.before(badge);
                        else if (pos === 'append') el.appendChild(badge);
                        else el.after(badge);
                    }
                };
            });
    }

    function init() {
        LOG('init() — hostname:', window.location.hostname);

        // Build adapters from config (provided by background.js)
        const customCfg = window.__wotCustomAdapters || {};
        const h = window.location.hostname;

        for (const [domain, rawCfg] of Object.entries(customCfg)) {
            if (h.includes(domain)) {
                adapters.push(...buildCustomAdapters(domain, rawCfg));
            }
        }

        LOG('Adapters:', adapters.length, adapters.map(a => a.name));

        if (adapters.length === 0) {
            LOG('No adapters configured for', h);
            return;
        }

        if (!getWotApi()) {
            LOG('window.nostr.wot not available yet, waiting for nostr-wot-ready event...');
            window.addEventListener('nostr-wot-ready', () => {
                LOG('nostr-wot-ready event received');
                if (!started) start();
            }, { once: true });
            setTimeout(() => {
                if (!started && getWotApi()) {
                    LOG('Retry: window.nostr.wot became available after 2s');
                    start();
                } else if (!started) {
                    WARN('window.nostr.wot still not available after 2s — badges will not work');
                }
            }, 2000);
            return;
        }
        LOG('window.nostr.wot is available immediately');
        start();
    }

    async function start() {
        if (started) return;
        started = true;
        LOG('start() — checking configuration...');

        try {
            const config = await getWotApi()!.getStatus();
            LOG('getStatus:', config);
            if (!(config as { configured?: boolean })?.configured) {
                WARN('Extension not configured — badges disabled');
                return;
            }
            const stats = await getWotApi()!.getStats();
            LOG('Graph stats:', stats);
            const statsObj = stats as { lastSync?: number | null } | null;
            if (statsObj?.lastSync) {
                graphStale = (Date.now() - statsObj.lastSync) > STALE_THRESHOLD;
                if (graphStale) LOG('Graph is stale (>24h)');
            }
        } catch (e: unknown) {
            WARN('Failed to check config/stats:', (e as Error).message);
            return;
        }

        LOG('Starting scan + MutationObserver');
        scan();

        window.__wotBadgeObserver = new MutationObserver(() => debounceScan());
        window.__wotBadgeObserver.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('popstate', () => debounceScan());
    }

    function debounceScan() {
        if (!window.__wotBadgeEngineRunning) return;
        if (mutationPaused) return; // ignore mutations caused by our own badge insertions
        if (scanTimer) return;
        scanTimer = setTimeout(() => { scanTimer = null; scan(); }, SCAN_DEBOUNCE);
    }

    // ── Scanning ──

    function scan() {
        if (!window.__wotBadgeEngineRunning) return;
        const claimed = new Set<string>();
        let totalFound = 0;

        for (const adapter of adapters) {
            totalFound += scanWithAdapter(adapter, claimed);
        }

        LOG('Scan complete:', totalFound, 'elements found,', pendingPubkeys.size, 'pending queries');

        if (pendingPubkeys.size > 0 && !batchTimer) {
            batchTimer = setTimeout(processBatch, BATCH_INTERVAL);
        }
    }

    const scanWithAdapter: ScanWithAdapterFn = Object.assign(
        function scanWithAdapterFn(adapter: BadgeAdapter, claimed: Set<string>): number {
            let count = 0;
            const adapterTag = adapter.strategyIdx != null ? String(adapter.strategyIdx) : adapter.name;
            const badgedAttr = 'data-wot-s' + adapterTag; // marks el as badged by this strategy
            for (const sel of adapter.selectors) {
                try {
                    const els = document.querySelectorAll(sel);
                    for (const el of els) {
                        // Use composite key so different strategies can badge the same element
                        const key = adapterTag + '::' + (el._wotId || (el._wotId = ++scanWithAdapter._idSeq));
                        if (claimed.has(key)) continue;
                        // Skip if this strategy already badged this element (works for all placements)
                        if (el.hasAttribute(badgedAttr)) continue;
                        const raw = adapter.extractPubkey(el);
                        const npub = normalizePubkey(raw);
                        if (npub) {
                            queueElement(el, npub, adapter);
                            claimed.add(key);
                            count++;
                        }
                    }
                } catch (e: unknown) {
                    WARN('Selector error in', adapter.name, ':', sel, (e as Error).message);
                }
            }
            if (count > 0) LOG('Adapter', adapter.name, 'found', count, 'elements');
            return count;
        },
        { _idSeq: 0 }
    );

    function queueElement(el: Element, npub: string, adapter: BadgeAdapter) {
        const cached = wotCache.get(npub);
        if (cached) {
            renderBadge(el, cached, adapter);
            return;
        }
        if (!pendingPubkeys.has(npub)) pendingPubkeys.set(npub, []);
        pendingPubkeys.get(npub)!.push({ el, adapter });
    }

    // ── Batch ──

    async function processBatch() {
        batchTimer = null;
        if (!window.__wotBadgeEngineRunning) return;
        if (pendingPubkeys.size === 0) return;

        const batch: string[] = [];
        const batchMeta = new Map<string, QueueItem[]>();

        for (const [npub, entries] of pendingPubkeys) {
            if (batch.length >= MAX_BATCH) break;
            batch.push(npub);
            batchMeta.set(npub, entries);
            pendingPubkeys.delete(npub);
        }

        LOG('Processing batch:', batch.length, 'npubs. Sample:', batch[0]?.slice(0, 20) + '...');

        try {
            const results = await getWotApi()!.getDistanceBatch(batch, { includePaths: true, includeScores: true });
            LOG('Batch results:', results ? Object.keys(results as object).length + ' entries' : 'null');
            if (results) {
                const iter: Iterable<[string, BadgeData | null]> = results instanceof Map
                    ? results.entries()
                    : Object.entries(results as Record<string, BadgeData | null>);
                let rendered = 0;
                for (const [npub, info] of iter) {
                    const data: BadgeData = info
                        ? { hops: info.hops, paths: info.paths, score: info.score ?? null }
                        : { hops: null, paths: null, score: null };
                    wotCache.set(npub, data);
                    const items = batchMeta.get(npub) || [];
                    for (const { el, adapter } of items) {
                        renderBadge(el, data, adapter);
                        rendered++;
                    }
                }
                LOG('Rendered', rendered, 'badges');
            }
        } catch (e: unknown) {
            WARN('Batch query failed:', (e as Error).message);
            for (const [, items] of batchMeta) {
                for (const { el } of items) el.setAttribute(BADGE_ATTR, 'error'); // informational only
            }
        }

        if (pendingPubkeys.size > 0) {
            batchTimer = setTimeout(processBatch, BATCH_INTERVAL);
        }
    }

    // ── Score-based color gradient ──

    const COLOR_STOPS: ColorStop[] = [
        { score: 0,   r: 107, g: 114, b: 128 }, // #6b7280 gray
        { score: 50,  r: 245, g: 158, b: 11  }, // #f59e0b orange
        { score: 65,  r: 234, g: 179, b: 8   }, // #eab308 yellow
        { score: 70,  r: 34,  g: 197, b: 94  }, // #22c55e green
        { score: 100, r: 56,  g: 189, b: 248 }, // #38bdf8 light blue
    ];

    function scoreToColor(score: number): { r: number; g: number; b: number } {
        const s = Math.max(0, Math.min(100, score));
        let lo = COLOR_STOPS[0], hi = COLOR_STOPS[COLOR_STOPS.length - 1];
        for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
            if (s >= COLOR_STOPS[i].score && s <= COLOR_STOPS[i + 1].score) {
                lo = COLOR_STOPS[i]; hi = COLOR_STOPS[i + 1]; break;
            }
        }
        const range = hi.score - lo.score;
        const t = range === 0 ? 0 : (s - lo.score) / range;
        const r = Math.round(lo.r + (hi.r - lo.r) * t);
        const g = Math.round(lo.g + (hi.g - lo.g) * t);
        const b = Math.round(lo.b + (hi.b - lo.b) * t);
        return { r, g, b };
    }

    // ── Rendering (safe — no innerHTML with untrusted data) ──

    function renderBadge(el: Element, data: BadgeData, adapter: BadgeAdapter) {
        if (!window.__wotBadgeEngineRunning) return;
        if (!el.isConnected) return;
        // Skip if this specific strategy already badged this element (attribute-based — works for all placements)
        const tag = adapter && adapter.strategyIdx != null ? String(adapter.strategyIdx) : '_';
        const badgedAttr = 'data-wot-s' + tag;
        if (el.hasAttribute(badgedAttr)) return;

        const badge = document.createElement('span');
        badge.className = 'wot-badge';

        // Tag badge with strategy index so per-strategy CSS is scoped
        if (adapter && adapter.strategyIdx != null) {
            badge.dataset.wotStrategy = String(adapter.strategyIdx);
        }

        const dot = document.createElement('span');
        dot.className = 'wot-badge-dot';

        if (data.hops === null) {
            badge.classList.add('wot-not-in-graph');
        } else if (data.hops === 0) {
            badge.setAttribute('data-hops', '0');
        } else {
            const score = data.score != null ? Math.round(data.score * 100) : 0;
            const { r, g, b } = scoreToColor(score);
            dot.style.background = `rgb(${r}, ${g}, ${b})`;
            dot.style.boxShadow = `0 0 0 2px rgba(${r}, ${g}, ${b}, 0.25)`;
        }

        badge.appendChild(dot);

        // Score text for 'score' display mode
        if (adapter && adapter.displayMode === 'score') {
            const text = document.createElement('span');
            text.className = 'wot-badge-text';
            if (data.hops === null) {
                text.textContent = '?';
            } else if (data.hops === 0) {
                text.textContent = 'You';
            } else {
                const pct = data.score != null ? Math.round(data.score * 100) : 0;
                text.textContent = pct + '%';
            }
            badge.appendChild(text);
        }

        if (graphStale) {
            badge.classList.add('wot-stale');
        }

        badge.addEventListener('mouseenter', () => showTooltip(badge, data));
        badge.addEventListener('mouseleave', () => hideTooltip());

        // Mark element as badged by this strategy, pause observer, then insert
        el.setAttribute(badgedAttr, '');
        mutationPaused = true;
        try {
            if (adapter && adapter.insertBadge) {
                adapter.insertBadge(el, badge);
            } else {
                el.after(badge);
            }
        } catch {
            try { el.after(badge); } catch { /* ignored */ }
        }
        mutationPaused = false;
    }

    // ── Tooltip (safe — all text via textContent) ──

    function showTooltip(badge: HTMLElement, data: BadgeData) {
        hideTooltip();
        const tip = document.createElement('div');
        tip.className = 'wot-tooltip';

        if (data.hops === null) {
            tip.appendChild(tooltipRow('Status', 'Not in your graph'));
        } else {
            const hopText = data.hops === 0 ? 'You' : data.hops + (data.hops === 1 ? ' hop' : ' hops');
            tip.appendChild(tooltipRow('Distance', hopText));
            if (data.paths != null && data.hops > 0) {
                tip.appendChild(tooltipRow('Paths', data.paths + ' shortest'));
            }
            if (data.score != null) {
                tip.appendChild(tooltipRow('Trust score', Math.round(data.score * 100) + '%'));
            }
        }

        if (graphStale) {
            const divider = document.createElement('div');
            divider.className = 'wot-tooltip-divider';
            tip.appendChild(divider);
            const warn = document.createElement('div');
            warn.className = 'wot-tooltip-follows';
            warn.style.color = '#fbbf24';
            warn.textContent = 'Graph may be outdated';
            tip.appendChild(warn);
        }

        // Position fixed above the badge dot
        const rect = badge.getBoundingClientRect();
        tip.style.left = rect.left + rect.width / 2 + 'px';
        tip.style.top = rect.top - 8 + 'px';

        document.body.appendChild(tip);
        activeTooltip = tip;
    }

    function tooltipRow(label: string, value: string): HTMLElement {
        const row = document.createElement('div');
        row.className = 'wot-tooltip-row';
        const l = document.createElement('span');
        l.className = 'wot-tooltip-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'wot-tooltip-value';
        v.textContent = value;
        row.appendChild(l);
        row.appendChild(v);
        return row;
    }

    function hideTooltip() {
        if (activeTooltip) {
            activeTooltip.remove();
            activeTooltip = null;
        }
    }

    // ── Refresh / reinit (called externally when config changes) ──

    function clearAllBadges() {
        mutationPaused = true;
        hideTooltip();
        wotCache.clear();
        document.querySelectorAll('.wot-badge').forEach(el => el.remove());
        document.querySelectorAll('[data-wot-badge]').forEach(el => el.removeAttribute('data-wot-badge'));
        // Clear badged-by-strategy markers (data-wot-s0, data-wot-s1, ...)
        document.querySelectorAll('[data-wot-s0],[data-wot-s1],[data-wot-s2],[data-wot-s3],[data-wot-s4],[data-wot-s5],[data-wot-s_]').forEach(el => {
            for (const attr of [...el.attributes]) {
                if (attr.name.startsWith('data-wot-s')) el.removeAttribute(attr.name);
            }
        });
        scanWithAdapter._idSeq = 0;
        mutationPaused = false;
    }

    window.__wotRefreshBadges = function () {
        if (!window.__wotBadgeEngineRunning) return;
        LOG('Refreshing badges (light refresh — same adapters)');
        clearAllBadges();
        if (started) scan();
    };

    /** Full reinit: rebuild adapters from current window.__wotCustomAdapters, then rescan. */
    window.__wotReinitBadges = function () {
        LOG('Reinit badges — rebuilding adapters from config');
        clearAllBadges();

        // Rebuild adapters from (re-injected) config
        adapters.length = 0;
        const customCfg = window.__wotCustomAdapters || {};
        const h = window.location.hostname;
        for (const [domain, rawCfg] of Object.entries(customCfg)) {
            if (h.includes(domain)) {
                adapters.push(...buildCustomAdapters(domain, rawCfg));
            }
        }
        LOG('Reinit adapters:', adapters.length, adapters.map(a => a.name));

        if (adapters.length === 0) {
            LOG('No adapters after reinit');
            return;
        }

        if (!started && getWotApi()) {
            start();
        } else if (started) {
            scan();
        }
    };

    // ── Start ──

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
