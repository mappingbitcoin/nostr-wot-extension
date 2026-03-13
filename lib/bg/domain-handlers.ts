/**
 * Domain, badge, tab, and injection handlers.
 * @module lib/bg/domain-handlers
 */

import browser from '../browser.ts';
import { getDomainFromUrl } from '@shared/url.ts';
import { getDefaultsForDomain } from '@shared/adapterDefaults.ts';
import { isRestrictedUrl, sanitizeCSS, type HandlerFn, type LocalAccountEntry } from './state.ts';

// ── Domain permission functions (with in-memory cache) ──

let _cachedDomains: string[] | null = null;
let _cachedAccountReadOnly: { accountId: string | undefined; readOnly: boolean } | null = null;

function invalidateDomainCache(): void { _cachedDomains = null; }
function invalidateAccountCache(): void { _cachedAccountReadOnly = null; }

// Invalidate caches on external storage changes
try {
    browser.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
        if (area === 'local') {
            if ((changes as Record<string, unknown>).allowedDomains) invalidateDomainCache();
            if ((changes as Record<string, unknown>).accounts || (changes as Record<string, unknown>).activeAccountId) invalidateAccountCache();
        }
    });
} catch { /* storage.onChanged may not be available in tests */ }

export async function getAllowedDomains(): Promise<string[]> {
    if (_cachedDomains !== null) return _cachedDomains;
    const data = await browser.storage.local.get('allowedDomains');
    _cachedDomains = (data as Record<string, string[]>).allowedDomains || [];
    return _cachedDomains;
}

export async function isDomainAllowed(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    return domains.includes(domain);
}

export async function addAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        await browser.storage.local.set({ allowedDomains: domains });
        invalidateDomainCache();
    }
    return true;
}

export async function removeAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    const filtered = domains.filter(d => d !== domain);
    await browser.storage.local.set({ allowedDomains: filtered });
    invalidateDomainCache();
    return true;
}

// ── Host permissions ──

export async function hasHostPermission(): Promise<boolean> {
    return browser.permissions.contains({ origins: ['<all_urls>'] });
}

export async function requestHostPermission(): Promise<boolean> {
    return browser.permissions.request({ origins: ['<all_urls>'] });
}

// ── Badge disable ──

export async function setBadgeDisabled(domain: string, disabled: boolean): Promise<boolean> {
    const data = await browser.storage.local.get('badgeDisabledSites');
    const sites = new Set((data as Record<string, string[]>).badgeDisabledSites || []);
    if (disabled) sites.add(domain);
    else sites.delete(domain);
    await browser.storage.local.set({ badgeDisabledSites: [...sites] });
    return true;
}

export async function removeBadgesFromTab(tabId: number): Promise<boolean> {
    const cleanupFunc = () => {
        (window as unknown as Record<string, unknown>).__wotBadgeEngineRunning = false;
        if ((window as unknown as Record<string, unknown>).__wotBadgeObserver) {
            ((window as unknown as Record<string, unknown>).__wotBadgeObserver as MutationObserver).disconnect();
            (window as unknown as Record<string, unknown>).__wotBadgeObserver = null;
        }
        document.querySelectorAll('.wot-badge').forEach(el => el.remove());
        document.querySelectorAll('.wot-tooltip').forEach(el => el.remove());
        document.querySelectorAll('[data-wot-badge]').forEach(el => el.removeAttribute('data-wot-badge'));
    };
    try {
        await browser.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: cleanupFunc
        });
        setTimeout(async () => {
            try {
                await browser.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    func: cleanupFunc
                });
            } catch { /* ignored */ }
        }, 600);
    } catch { /* ignored */ }
    return true;
}

// ── Tab broadcast / refresh ──

export async function broadcastAccountChanged(pubkey: string): Promise<void> {
    try {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (isRestrictedUrl(tab.url)) continue;
            browser.tabs.sendMessage(tab.id!, { type: 'NOSTR_ACCOUNT_CHANGED', pubkey }).catch(() => {});
        }
    } catch (e: unknown) {
        console.warn('[BG] broadcastAccountChanged failed:', (e as Error).message);
    }
}

export async function refreshBadgesOnAllTabs(): Promise<void> {
    try {
        const customData = await browser.storage.local.get(['customAdapters']);
        const customAdapters = (customData as Record<string, Record<string, unknown>>).customAdapters || {};
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (isRestrictedUrl(tab.url)) continue;
            const domain = getDomainFromUrl(tab.url);
            if (!domain || !(await isDomainAllowed(domain))) continue;
            try {
                const effectiveConfig: Record<string, unknown> = {};
                if (customAdapters[domain]) {
                    effectiveConfig[domain] = customAdapters[domain];
                } else {
                    const defaults = getDefaultsForDomain(domain);
                    effectiveConfig[domain] = { version: 2, strategies: defaults };
                }
                await browser.scripting.executeScript({
                    target: { tabId: tab.id! },
                    world: 'MAIN',
                    func: (cfg: Record<string, unknown>) => {
                        (window as unknown as Record<string, unknown>).__wotCustomAdapters = cfg;
                        if (typeof (window as unknown as Record<string, unknown>).__wotReinitBadges === 'function') ((window as unknown as Record<string, unknown>).__wotReinitBadges as () => void)();
                        else if (typeof (window as unknown as Record<string, unknown>).__wotRefreshBadges === 'function') ((window as unknown as Record<string, unknown>).__wotRefreshBadges as () => void)();
                    },
                    args: [effectiveConfig]
                });
            } catch { /* ignored */ }
        }
    } catch { /* ignored */ }
}

// ── Read-only guard ──

export async function isActiveAccountReadOnly(): Promise<boolean> {
    const data = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
    const activeId = data.activeAccountId as string | undefined;
    if (_cachedAccountReadOnly && _cachedAccountReadOnly.accountId === activeId) {
        return _cachedAccountReadOnly.readOnly;
    }
    const acct = ((data.accounts as LocalAccountEntry[]) || []).find(a => a.id === activeId);
    const readOnly = !!(acct?.readOnly || acct?.type === 'npub');
    _cachedAccountReadOnly = { accountId: activeId, readOnly };
    return readOnly;
}

// ── Identity disable ──

export async function isIdentityDisabled(domain: string): Promise<boolean> {
    const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
    return (data.identityDisabledSites || []).includes(domain);
}

async function setIdentityDisabled(domain: string, disabled: boolean): Promise<boolean> {
    const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
    const sites = new Set(data.identityDisabledSites || []);
    if (disabled) sites.add(domain);
    else sites.delete(domain);
    await browser.storage.local.set({ identityDisabledSites: [...sites] });
    return true;
}

// ── CSS strategy helpers ──

/** Build per-strategy custom CSS from an adapter config. */
function buildStrategyCSS(cfg: Record<string, unknown>): string[] {
    const parts: string[] = [];
    if (cfg.customCSS) parts.push(sanitizeCSS(cfg.customCSS as string));
    if (Array.isArray(cfg.strategies)) {
        for (let i = 0; i < cfg.strategies.length; i++) {
            const s = cfg.strategies[i] as Record<string, unknown>;
            if (s.customCSS && s.enabled !== false) {
                parts.push(sanitizeCSS(s.customCSS as string).replace(
                    /\.wot-badge(?![-\w])/g,
                    `.wot-badge[data-wot-strategy="${i}"]`
                ));
            }
        }
    }
    return parts;
}

// ── Enable for current domain ──

async function enableForCurrentDomain(): Promise<{ ok: boolean; domain?: string; error: string | null }> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            return { ok: false, error: 'No active tab' };
        }

        const domain = getDomainFromUrl(tab.url);
        if (!domain) {
            return { ok: false, error: 'Could not get domain from URL' };
        }

        if (isRestrictedUrl(tab.url)) {
            return { ok: false, error: 'Cannot enable on this page' };
        }

        await addAllowedDomain(domain);
        const injected = await injectIntoTab(tab.id!, tab.url);

        return { ok: injected, domain, error: injected ? null : 'Injection failed' };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// ── Tab injection ──

export async function injectIntoTab(tabId: number, url: string): Promise<boolean> {
    if (isRestrictedUrl(url)) {
        return false;
    }

    try {
        const wotSettings = await browser.storage.sync.get(['wotInjectionEnabled']) as Record<string, unknown>;
        const domain = url ? getDomainFromUrl(url) : null;
        const badgeDisabledData = await browser.storage.local.get(['badgeDisabledSites']) as Record<string, string[]>;
        const badgeDisabledSites = new Set(badgeDisabledData.badgeDisabledSites || []);
        if (wotSettings.wotInjectionEnabled !== false && (!domain || !badgeDisabledSites.has(domain))) {
            try {
                await browser.scripting.insertCSS({
                    target: { tabId },
                    files: ['badges/badges.css']
                });
                const customData = await browser.storage.local.get(['customAdapters']) as Record<string, Record<string, unknown>>;
                const customAdapters = customData.customAdapters || {};
                const effectiveConfig: Record<string, unknown> = {};
                if (domain) {
                    if (customAdapters[domain]) {
                        effectiveConfig[domain] = customAdapters[domain];
                    } else {
                        const defaults = getDefaultsForDomain(domain);
                        effectiveConfig[domain] = { version: 2, strategies: defaults };
                    }
                }
                if (Object.keys(effectiveConfig).length > 0) {
                    await browser.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: (cfg: Record<string, unknown>) => { (window as unknown as Record<string, unknown>).__wotCustomAdapters = cfg; },
                        args: [effectiveConfig]
                    });
                }
                if (domain && effectiveConfig[domain]) {
                    const parts = buildStrategyCSS(effectiveConfig[domain] as Record<string, unknown>);
                    if (parts.length > 0) {
                        await browser.scripting.insertCSS({
                            target: { tabId },
                            css: parts.join('\n')
                        });
                    }
                }
                await browser.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    files: ['badges/engine.js']
                });
            } catch { /* ignored */ }
        }

        return true;
    } catch {
        return false;
    }
}

// ── Host access request (Chrome 133+) ──

export async function requestHostAccessIfNeeded(tabId: number, url: string): Promise<void> {
    if (isRestrictedUrl(url)) {
        return;
    }
    const hasAllSites = await hasHostPermission();
    if (hasAllSites) return;

    if ((browser.permissions as unknown as Record<string, unknown>)?.addHostAccessRequest) {
        try {
            await (browser.permissions as unknown as Record<string, (opts: { tabId: number }) => Promise<void>>).addHostAccessRequest({ tabId });
        } catch {
            // Not supported or tab closed — ignore
        }
    }
}

// ── Nostr pubkey from active tab ──

async function getNostrPubkeyFromActiveTab(): Promise<string | null> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;

        const results = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async () => {
                try {
                    if ((window as unknown as Record<string, unknown>).nostr && typeof ((window as unknown as Record<string, unknown>).nostr as Record<string, unknown>).getPublicKey === 'function') {
                        return await (((window as unknown as Record<string, unknown>).nostr as Record<string, unknown>).getPublicKey as () => Promise<string>)();
                    }
                } catch {
                    return null;
                }
                return null;
            }
        });

        return results?.[0]?.result || null;
    } catch {
        return null;
    }
}

async function injectWotApi(): Promise<{ ok: boolean; url?: string; error?: string }> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'No active tab' };

        if (isRestrictedUrl(tab.url)) {
            return { ok: false, error: 'Cannot inject on this page' };
        }

        return { ok: true, url: tab.url };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// ── Tab listeners setup (called from background.ts) ──

export function setupTabListeners(): void {
    browser.tabs.onUpdated.addListener(async (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
        if (changeInfo.status !== 'complete') return;
        if (!tab.url) return;

        const domain = getDomainFromUrl(tab.url);
        if (domain && await isDomainAllowed(domain)) {
            await injectIntoTab(tabId, tab.url);
        }
    });

    browser.tabs.onCreated.addListener(async (tab: chrome.tabs.Tab) => {
        if (!tab.url || tab.status !== 'complete') return;

        const domain = getDomainFromUrl(tab.url);
        if (domain && await isDomainAllowed(domain)) {
            await injectIntoTab(tab.id!, tab.url);
        }
    });

    browser.tabs.onActivated.addListener(async ({ tabId }: chrome.tabs.OnActivatedInfo) => {
        try {
            const tab = await browser.tabs.get(tabId);
            if (tab.url) {
                const domain = getDomainFromUrl(tab.url);
                if (domain && await isDomainAllowed(domain)) {
                    await injectIntoTab(tabId, tab.url);
                }
            }
        } catch {
            // Tab may have been closed
        }
    });

    if (browser.permissions?.onAdded) {
        browser.permissions.onAdded.addListener(async (permissions: chrome.permissions.Permissions) => {
            if (permissions.origins?.length) {
                try {
                    for (const origin of permissions.origins) {
                        const match = origin.match(/^\*:\/\/(?:\*\.)?([^/]+)\/\*$/);
                        if (match?.[1]) {
                            await addAllowedDomain(match[1]);
                        }
                    }
                    const tabs = await browser.tabs.query({ status: 'complete' });
                    for (const tab of tabs) {
                        if (tab.url && tab.id) {
                            const d = getDomainFromUrl(tab.url);
                            if (d && await isDomainAllowed(d)) {
                                await injectIntoTab(tab.id, tab.url);
                            }
                        }
                    }
                } catch { /* ignored */ }
            }
        });
    }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getAllowedDomains', async () => getAllowedDomains()],
    ['isDomainAllowed', async (params) => isDomainAllowed(params.domain as string)],
    ['addAllowedDomain', async (params) => addAllowedDomain(params.domain as string)],
    ['removeAllowedDomain', async (params) => removeAllowedDomain(params.domain as string)],
    ['hasHostPermission', async () => hasHostPermission()],
    ['requestHostPermission', async () => requestHostPermission()],
    ['setBadgeDisabled', async (params) => setBadgeDisabled(params.domain as string, params.disabled as boolean)],
    ['removeBadgesFromTab', async (params) => removeBadgesFromTab(params.tabId as number)],
    ['enableForCurrentDomain', async () => enableForCurrentDomain()],

    ['getCustomAdapters', async () => {
        const cData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
        return cData.customAdapters || {};
    }],

    ['saveCustomAdapter', async (params) => {
        const caData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
        const cas = caData.customAdapters || {};
        cas[params.domain as string] = params.config as Record<string, unknown>;
        await browser.storage.local.set({ customAdapters: cas });
        return true;
    }],

    ['deleteCustomAdapter', async (params) => {
        const daData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
        const das = daData.customAdapters || {};
        delete das[params.domain as string];
        await browser.storage.local.set({ customAdapters: das });
        return true;
    }],

    ['previewBadgeConfig', async (params) => {
        const previewDomain = params.domain as string;
        const previewConfig = params.config as Record<string, unknown>;
        const previewTabs = await browser.tabs.query({});
        for (const tab of previewTabs) {
            if (!tab.url) continue;
            const td = getDomainFromUrl(tab.url);
            if (!td || !td.includes(previewDomain)) continue;
            try {
                const effectiveCfg: Record<string, unknown> = {};
                effectiveCfg[td] = previewConfig;
                const parts = buildStrategyCSS(previewConfig);
                if (parts.length > 0) {
                    await browser.scripting.insertCSS({
                        target: { tabId: tab.id! },
                        css: parts.join('\n')
                    });
                }
                await browser.scripting.executeScript({
                    target: { tabId: tab.id! },
                    world: 'MAIN',
                    func: (cfg: Record<string, unknown>) => {
                        (window as unknown as Record<string, unknown>).__wotCustomAdapters = cfg;
                        if (typeof (window as unknown as Record<string, unknown>).__wotReinitBadges === 'function') ((window as unknown as Record<string, unknown>).__wotReinitBadges as () => void)();
                    },
                    args: [effectiveCfg]
                });
            } catch { /* ignored */ }
        }
        return true;
    }],

    ['setIdentityDisabled', async (params) => setIdentityDisabled(params.domain as string, params.disabled as boolean)],

    ['getIdentityDisabledSites', async () => {
        const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
        return data.identityDisabledSites || [];
    }],

    ['getNostrPubkey', async () => getNostrPubkeyFromActiveTab()],
    ['injectWotApi', async () => injectWotApi()],
]);
