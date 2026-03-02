
import browser from './lib/browser.ts';
import { RemoteOracle } from './lib/api.ts';
import { LocalGraph } from './lib/graph.ts';
import { GraphSync, isSyncInProgress, stopSync } from './lib/sync.ts';
import { calculateScore, DEFAULT_SCORING } from './lib/scoring.ts';
import * as storage from './lib/storage.ts';
import * as vault from './lib/vault.ts';
import * as signer from './lib/signer.ts';
import * as signerPermissions from './lib/permissions.ts';
import * as accounts from './lib/accounts.ts';
import { nsecEncode, npubEncode, npubDecode } from './lib/crypto/bech32.ts';
import { getDomainFromUrl } from './src/shared/url.ts';
import { bytesToHex } from './lib/crypto/utils.ts';
import { ncryptsecEncode, ncryptsecDecode } from './lib/crypto/nip49.ts';
import { signEvent } from './lib/crypto/nip01.ts';
import { getDefaultsForDomain } from './src/shared/adapterDefaults.ts';
import { Nip46Client } from './lib/nip46.ts';
import type { Account, SignedEvent, ScoringConfig, UnsignedEvent, VaultPayload } from './lib/types.ts';

// Sanitize user-provided CSS to prevent data exfiltration via url(), @import, etc.
function sanitizeCSS(css: string): string {
    if (!css) return css;
    return css
        .replace(/@import\b[^;]*;?/gi, '/* @import removed */')
        .replace(/url\s*\([^)]*\)/gi, '/* url() removed */')
        .replace(/expression\s*\([^)]*\)/gi, '/* expression() removed */');
}

const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com'];

// In-memory sessions for pending nostrconnect:// QR flows
interface NostrConnectSession {
    client: Nip46Client;
    relay: string;
    localPrivkey: string;
    localPubkey: string;
    signerPubkey: string | null;
    connected: boolean;
    expired: boolean;
}
const _nostrConnectSessions = new Map<string, NostrConnectSession>();

// Rate limiting for WoT API methods only (50 requests per second per method)
const RATE_LIMIT_PER_SECOND = 50;
const RATE_LIMIT_WINDOW_MS = 1000;
interface RateLimitState { count: number; windowStart: number; }
const rateLimitState = new Map<string, RateLimitState>();

// Only WoT computation methods are rate limited (NIP-07 is gated by permissions)
const RATE_LIMITED_METHODS = new Set([
    'getDistance', 'isInMyWoT', 'getTrustScore',
    'getDetails', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
    'getFollows', 'getCommonFollows', 'getPath', 'getStats',
]);

// Methods only callable from the extension itself (popup, onboarding, prompt pages)
const PRIVILEGED_METHODS = new Set([
    'switchAccount',
    'vault_unlock', 'vault_lock', 'vault_create', 'vault_isLocked', 'vault_exists',
    'vault_listAccounts', 'vault_addAccount', 'vault_removeAccount',
    'vault_setActiveAccount', 'vault_getActivePubkey', 'vault_setAutoLock', 'vault_getAutoLock',
    'vault_exportNsec', 'vault_exportNcryptsec', 'vault_exportSeed', 'vault_importNcryptsec', 'vault_changePassword',
    'vault_getActiveAccountType',
    'signer_getPermissions', 'signer_getPermissionsForDomain',
    'signer_clearPermissions', 'signer_savePermission',
    'signer_getPermissionsRaw', 'signer_getPermissionsForDomainRaw',
    'signer_copyPermissions', 'signer_getUseGlobalDefaults', 'signer_setUseGlobalDefaults',
    'signer_getPending', 'signer_resolve', 'signer_resolveBatch',
    'onboarding_validateNsec', 'onboarding_validateNcryptsec', 'onboarding_validateMnemonic', 'onboarding_validateNpub', 'onboarding_connectNip46',
    'onboarding_generateAccount', 'onboarding_checkExistingSeed', 'onboarding_generateSubAccount',
    'onboarding_exportNcryptsec', 'onboarding_saveReadOnly', 'onboarding_createVault', 'onboarding_addToVault',
    'onboarding_initNostrConnect', 'onboarding_pollNostrConnect', 'onboarding_cancelNostrConnect',
    'configUpdated', 'syncGraph', 'stopSync', 'clearGraph',
    'requestHostPermission', 'enableForCurrentDomain',
    'addAllowedDomain', 'removeAllowedDomain',
    'setBadgeDisabled', 'removeBadgesFromTab',
    'getCustomAdapters', 'saveCustomAdapter', 'deleteCustomAdapter',
    'setIdentityDisabled', 'getIdentityDisabledSites',
    'listDatabases', 'getDatabaseStats', 'deleteAccountDatabase', 'deleteAllDatabases',
    'injectWotApi', 'getNostrPubkey',
    'getActivityLog', 'clearActivityLog',
    'getLocalBlocks', 'addLocalBlock', 'removeLocalBlock',
    'publishRelayList', 'signAndPublishEvent', 'signEvent', 'updateProfileCache',
    'fetchMuteList', 'getMuteLists', 'removeMuteList', 'toggleMuteList', 'saveMuteList',
    'nip46_getSessionInfo', 'nip46_revokeSession',
    'checkRelayHealth', 'checkOracleHealth',
    'previewBadgeConfig', 'getAllowedDomains', 'isDomainAllowed',
    'getSyncState', 'hasHostPermission', 'getProfileMetadata', 'getProfileMetadataBatch',
]);

function checkRateLimit(method: string): boolean {
    if (!RATE_LIMITED_METHODS.has(method)) {
        return true; // Not rate limited
    }

    const now = Date.now();
    let state = rateLimitState.get(method);

    if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
        // Start a new window
        state = { count: 1, windowStart: now };
        rateLimitState.set(method, state);
        return true;
    }

    if (state.count >= RATE_LIMIT_PER_SECOND) {
        return false; // Rate limit exceeded
    }

    state.count++;
    return true;
}

interface ExtConfig {
    mode: string;
    oracleUrl: string;
    oracleUrls?: string[];
    myPubkey: string | null;
    relays: string[];
    maxHops: number;
    timeout: number;
    scoring: ScoringConfig;
}

let config: ExtConfig = {
    mode: 'hybrid',  // 'local' | 'hybrid' | 'remote'
    oracleUrl: DEFAULT_ORACLE_URL,
    myPubkey: null,
    relays: DEFAULT_RELAYS,
    maxHops: 3,
    timeout: 5000,
    scoring: DEFAULT_SCORING,
};

// Temporary storage for full account data (with privkey) during onboarding.
// The popup only receives stripped accounts (no privkey), so the background
// holds the full account here until onboarding_createVault consumes it.
// Stored in chrome.storage.session so it survives service worker restarts.
// Cleared immediately after vault creation.
let _pendingOnboardingAccount: Account | null = null;
let _pendingOnboardingTimer: ReturnType<typeof setTimeout> | null = null;
const ONBOARDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function setPendingOnboardingAccount(acct: Account | null): Promise<void> {
    _pendingOnboardingAccount = acct;
    if (_pendingOnboardingTimer) { clearTimeout(_pendingOnboardingTimer); _pendingOnboardingTimer = null; }
    if (acct) {
        await browser.storage.session.set({ _pendingOnboardingAccount: acct });
        _pendingOnboardingTimer = setTimeout(() => setPendingOnboardingAccount(null), ONBOARDING_TTL_MS);
    } else {
        await browser.storage.session.remove('_pendingOnboardingAccount');
    }
}

async function getPendingOnboardingAccount(): Promise<Account | null> {
    if (_pendingOnboardingAccount) return _pendingOnboardingAccount;
    const data = await browser.storage.session.get('_pendingOnboardingAccount');
    return (data as Record<string, Account | null>)._pendingOnboardingAccount || null;
}

let oracle: RemoteOracle | null = null;
let localGraph: LocalGraph | null = null;

// Load config on startup
loadConfig();

// Clean up stale signer pending requests once on cold start
// (resolvers are lost when service worker restarts, so stale entries can never resolve)
signer.cleanupStale();
signerPermissions.migrateToPerKind();
signerPermissions.migrateToPerAccount();
signerPermissions.migrateForwardToAsk();

// Auto-unlock vault when auto-lock is "Never" (empty password).
// Service worker restarts clear in-memory state, so re-unlock automatically.
// After unlock, sync vault's internal activeAccountId with storage.local so
// getPrivkey(accountId) can find the right account.
(async () => {
    try {
        const data = await browser.storage.local.get(['autoLockMs', 'activeAccountId']);
        if (((data as Record<string, unknown>).autoLockMs ?? 900000) === 0 && await vault.exists()) {
            const ok = await vault.unlock('');
            if (ok) {
                // Sync vault active account with the canonical storage.local value
                if ((data as Record<string, unknown>).activeAccountId) {
                    try {
                        await vault.setActiveAccount((data as Record<string, unknown>).activeAccountId as string);
                    } catch {
                        // Account not in vault (read-only) — clear so vault doesn't
                        // serve a stale account for getPrivkey/getActiveAccount
                        vault.clearActiveAccount();
                    }
                }
                await signer.onVaultUnlocked();
            }
        }
    } catch (e: unknown) {
        console.warn('[VAULT] Auto-unlock failed:', (e as Error).message);
    }
})();

// === Auto-injection on tab navigation ===

// Check if we have host permissions for auto-injection
async function hasHostPermission(): Promise<boolean> {
    return browser.permissions.contains({ origins: ['<all_urls>'] });
}

// Request host permission for auto-injection
async function requestHostPermission(): Promise<boolean> {
    return browser.permissions.request({ origins: ['<all_urls>'] });
}

// === Per-domain permission system ===

// Get list of allowed domains
async function getAllowedDomains(): Promise<string[]> {
    const data = await browser.storage.local.get('allowedDomains');
    return (data as Record<string, string[]>).allowedDomains || [];
}

// Check if a domain is in the allowed list
async function isDomainAllowed(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    return domains.includes(domain);
}

// Add a domain to the allowed list
async function addAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        await browser.storage.local.set({ allowedDomains: domains });
    }
    return true;
}

// Remove a domain from the allowed list
async function removeAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    const filtered = domains.filter(d => d !== domain);
    await browser.storage.local.set({ allowedDomains: filtered });
    return true;
}

// === Per-domain badge disable (used by injectIntoTab and popup toggle) ===

async function setBadgeDisabled(domain: string, disabled: boolean): Promise<boolean> {
    const data = await browser.storage.local.get('badgeDisabledSites');
    const sites = new Set((data as Record<string, string[]>).badgeDisabledSites || []);
    if (disabled) sites.add(domain);
    else sites.delete(domain);
    await browser.storage.local.set({ badgeDisabledSites: [...sites] });
    return true;
}

async function removeBadgesFromTab(tabId: number): Promise<boolean> {
    const cleanupFunc = () => {
        // Stop the engine — flag checked by scan/debounceScan/processBatch/renderBadge
        (window as unknown as Record<string, unknown>).__wotBadgeEngineRunning = false;
        // Disconnect the MutationObserver so it stops triggering scans
        if ((window as unknown as Record<string, unknown>).__wotBadgeObserver) {
            ((window as unknown as Record<string, unknown>).__wotBadgeObserver as MutationObserver).disconnect();
            (window as unknown as Record<string, unknown>).__wotBadgeObserver = null;
        }
        // Remove all badges, tooltips, and clear scan markers
        document.querySelectorAll('.wot-badge').forEach(el => el.remove());
        document.querySelectorAll('.wot-tooltip').forEach(el => el.remove());
        document.querySelectorAll('[data-wot-badge]').forEach(el => el.removeAttribute('data-wot-badge'));
    };
    try {
        // First pass: stop engine and remove badges
        await browser.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: cleanupFunc
        });
        // Second pass after delay: catch badges rendered by in-flight batch requests
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

// Refresh badges on all allowed-domain tabs (e.g. after scoring config changes)
async function broadcastAccountChanged(pubkey: string): Promise<void> {
    try {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
                tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) continue;
            browser.tabs.sendMessage(tab.id!, { type: 'NOSTR_ACCOUNT_CHANGED', pubkey }).catch(() => {});
        }
    } catch (e: unknown) {
        console.warn('[BG] broadcastAccountChanged failed:', (e as Error).message);
    }
}

async function refreshBadgesOnAllTabs(): Promise<void> {
    try {
        const customData = await browser.storage.local.get(['customAdapters']);
        const customAdapters = (customData as Record<string, Record<string, unknown>>).customAdapters || {};
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
                tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) continue;
            const domain = getDomainFromUrl(tab.url);
            if (!domain || !(await isDomainAllowed(domain))) continue;
            try {
                // Build effective config for this domain
                const effectiveConfig: Record<string, unknown> = {};
                if (customAdapters[domain]) {
                    effectiveConfig[domain] = customAdapters[domain];
                } else {
                    const defaults = getDefaultsForDomain(domain);
                    effectiveConfig[domain] = { version: 2, strategies: defaults };
                }
                // Re-inject config into page, then reinit engine
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

// === Read-only account guard (reject all signing for npub-only accounts) ===

async function isActiveAccountReadOnly(): Promise<boolean> {
    const data = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
    const acct = ((data.accounts as Array<{ id: string; readOnly?: boolean; type?: string }>) || []).find(a => a.id === data.activeAccountId);
    return !!(acct?.readOnly || acct?.type === 'npub');
}

// === Per-domain identity disable (blocks NIP-07 without deleting permissions) ===

async function isIdentityDisabled(domain: string): Promise<boolean> {
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


// Enable WoT API for the current tab's domain and inject immediately
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

        // Skip restricted URLs
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
            tab.url.startsWith('about:') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
            return { ok: false, error: 'Cannot enable on this page' };
        }

        // Add domain to allowed list (permission request handled by popup)
        await addAllowedDomain(domain);

        // Inject immediately into current tab
        const injected = await injectIntoTab(tab.id!, tab.url);

        return { ok: injected, domain, error: injected ? null : 'Injection failed' };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// Inject WoT badges into a specific tab.
// Note: inject.js and content.js are handled by declarative content_scripts
// in the manifest (run_at: document_start), so they don't need programmatic injection.
async function injectIntoTab(tabId: number, url: string): Promise<boolean> {
    // Skip restricted URLs
    if (!url || url.startsWith('chrome://') || url.startsWith('edge://') ||
        url.startsWith('about:') || url.startsWith('chrome-extension://')) {
        return false;
    }

    try {
        // Inject WoT badge system if enabled globally and not disabled for this site
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
                // Build effective config for this domain:
                // user custom config takes precedence, otherwise use built-in defaults
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
                // Inject config into page
                if (Object.keys(effectiveConfig).length > 0) {
                    await browser.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: (cfg: Record<string, unknown>) => { (window as unknown as Record<string, unknown>).__wotCustomAdapters = cfg; },
                        args: [effectiveConfig]
                    });
                }
                // Inject custom CSS for this domain (scoped per strategy)
                if (domain && effectiveConfig[domain]) {
                    const cfg = effectiveConfig[domain] as Record<string, unknown>;
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
                    if (parts.length > 0) {
                        await browser.scripting.insertCSS({
                            target: { tabId },
                            css: parts.join('\n')
                        });
                    }
                }
                // Inject the badge engine
                await browser.scripting.executeScript({
                    target: { tabId },
                    world: 'MAIN',
                    files: ['badges/engine.js']
                });
            } catch { /* ignored */ }
        }

        return true;
    } catch {
        // Permission denied or tab closed
        return false;
    }
}

// === Host access request (Chrome 133+) ===
// When the user has restricted our site access, show a request in the toolbar
// so they can easily re-grant it. This uses no new permissions.

async function requestHostAccessIfNeeded(tabId: number, url: string): Promise<void> {
    if (!url || url.startsWith('chrome://') || url.startsWith('edge://') ||
        url.startsWith('about:') || url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')) {
        return;
    }
    // Only request if we don't already have broad host permission
    const hasAllSites = await hasHostPermission();
    if (hasAllSites) return;

    // Feature-detect addHostAccessRequest (Chrome 133+)
    if ((browser.permissions as unknown as Record<string, unknown>)?.addHostAccessRequest) {
        try {
            await (browser.permissions as unknown as Record<string, (opts: { tabId: number }) => Promise<void>>).addHostAccessRequest({ tabId });
        } catch {
            // Not supported or tab closed — ignore
        }
    }
}

// Listen for tab updates to auto-inject
browser.tabs.onUpdated.addListener(async (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
    // Only inject when page has completed loading
    if (changeInfo.status !== 'complete') return;
    if (!tab.url) return;

    // Only inject on explicitly connected domains
    const domain = getDomainFromUrl(tab.url);
    if (domain && await isDomainAllowed(domain)) {
        await injectIntoTab(tabId, tab.url);
    }
});

// Also inject when a new tab is created with a URL
browser.tabs.onCreated.addListener(async (tab: chrome.tabs.Tab) => {
    if (!tab.url || tab.status !== 'complete') return;

    // Only inject on explicitly connected domains
    const domain = getDomainFromUrl(tab.url);
    if (domain && await isDomainAllowed(domain)) {
        await injectIntoTab(tab.id!, tab.url);
    }
});

// Inject badges when switching to an existing tab (if connected)
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

// === React to permission changes ===
// When the user grants/revokes host permissions via the browser UI,
// re-inject into matching tabs or clean up as needed.

if (browser.permissions?.onAdded) {
    browser.permissions.onAdded.addListener(async (permissions: chrome.permissions.Permissions) => {
        // When host permissions are granted, auto-add domains to allowedDomains
        // This handles the case where the popup closes during the permission prompt
        if (permissions.origins?.length) {
            try {
                for (const origin of permissions.origins) {
                    // Extract domain from origin pattern like "*://*.example.com/*" or "*://example.com/*"
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

if (browser.permissions?.onRemoved) {
    browser.permissions.onRemoved.addListener(async (_permissions: chrome.permissions.Permissions) => {
        // Nothing to clean up — content scripts are already gone on restricted pages.
    });
}

async function loadConfig(): Promise<void> {
    const data = await browser.storage.sync.get([
        'mode', 'oracleUrl', 'myPubkey', 'relays', 'scoring'
    ]) as Record<string, unknown>;

    config.mode = (data.mode as string) || 'hybrid';
    config.myPubkey = (data.myPubkey as string) || null;
    config.maxHops = 3;
    config.timeout = 5000;
    config.scoring = (data.scoring as ScoringConfig) || DEFAULT_SCORING;

    // Parse oracle URLs (comma-separated), use first for primary oracle
    const oracleCsv = (data.oracleUrl as string) || DEFAULT_ORACLE_URL;
    config.oracleUrls = oracleCsv.split(',').map(u => u.trim()).filter(Boolean);
    config.oracleUrl = config.oracleUrls[0] || DEFAULT_ORACLE_URL;

    // Parse relays from comma-separated string
    if (data.relays) {
        config.relays = (data.relays as string).split(',').map(r => r.trim()).filter(Boolean);
    }

    // Initialize storage with active account's database
    const localData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
    let activeAccountId = localData.activeAccountId as string | undefined;

    // Migration: if no accounts in local storage but myPubkey exists, create one
    if (!activeAccountId && data.myPubkey) {
        let accts = (localData.accounts as Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>) || [];
        if (accts.length === 0) {
            const id = Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
            accts = [{ id, name: 'Default', pubkey: data.myPubkey as string, type: 'npub', readOnly: true }];
            activeAccountId = id;
            await browser.storage.local.set({ accounts: accts, activeAccountId: id });
        } else {
            activeAccountId = accts[0].id;
            await browser.storage.local.set({ activeAccountId });
        }
    }

    // Fall back to vault account if still no ID
    if (!activeAccountId) {
        activeAccountId = vault.getActiveAccountId() ?? undefined;
    }

    if (activeAccountId) {
        await storage.migrateGlobalDatabase(activeAccountId);
        await storage.initDB(activeAccountId);
    }
    // No activeAccountId — DB will be initialized when an account is activated

    oracle = new RemoteOracle(config.oracleUrl);
    localGraph = new LocalGraph();

    // Clean up stale sync state from interrupted syncs (e.g., service worker restart)
    try {
        const syncState = await storage.getMeta('syncState') as Record<string, unknown> | null;
        if (syncState?.inProgress) {
            await storage.setMeta('syncState', { inProgress: false });
        }
    } catch { /* ignored */ }

}

// Handle messages from content script and popup
browser.runtime.onMessage.addListener((request: Record<string, unknown>, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    const method = request?.method as string | undefined;

    // Gate privileged methods to internal extension pages only
    if (method && PRIVILEGED_METHODS.has(method)) {
        const senderUrl = sender.url || sender.tab?.url || '';
        const isInternal = sender.id === browser.runtime.id &&
            (!sender.tab || senderUrl.startsWith(browser.runtime.getURL('')));
        if (!isInternal) {
            sendResponse({ error: 'Permission denied' });
            return true;
        }
    }

    // Defense-in-depth: derive NIP-07 origin from browser-verified sender info
    if (method?.startsWith('nip07_')) {
        // Use frame-aware origin: sender.url for iframes, sender.tab.url for top-level
        const originUrl = sender.frameId === 0
            ? sender.tab?.url
            : (sender.url || sender.tab?.url);
        if (!originUrl) {
            sendResponse({ error: 'Cannot determine request origin' });
            return true;
        }
        (request.params as Record<string, unknown>).origin = new URL(originUrl).hostname;
    }

    handleRequest(request as { method: string; params: Record<string, unknown> })
        .then(result => {
            sendResponse({ result });
        })
        .catch(error => {
            sendResponse({ error: (error as Error).message || (error as { name?: string }).name || 'Unknown error' });
        });
    return true; // Async response
});

// npub→hex using shared bech32 decoder (returns null on invalid input)
function npubToHex(npub: string): string | null {
    try { return npubDecode(npub); } catch { return null; }
}

interface ActivityEntry {
    domain?: string;
    method: string;
    decision: string;
    kind?: number;
    event?: Record<string, unknown>;
    theirPubkey?: string;
}

interface DistanceInfo {
    hops: number;
    paths?: number | null;
    score?: number;
}

interface BatchOptions {
    includePaths?: boolean;
    includeScores?: boolean;
}

function validateNip07Params(method: string, params: Record<string, unknown>): void {
    if (method === 'nip07_signEvent') {
        const evt = params.event;
        if (!evt || typeof evt !== 'object') throw new Error('Invalid event');
        const e = evt as Record<string, unknown>;
        if (typeof e.kind !== 'number' || !Number.isInteger(e.kind) || e.kind < 0)
            throw new Error('Invalid event kind');
        if (typeof e.content !== 'string') throw new Error('Invalid event content');
    }
    if (method === 'nip07_nip04Encrypt' || method === 'nip07_nip44Encrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        if (typeof params.plaintext !== 'string') throw new Error('Invalid plaintext');
    }
    if (method === 'nip07_nip04Decrypt' || method === 'nip07_nip44Decrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        if (typeof params.ciphertext !== 'string') throw new Error('Invalid ciphertext');
    }
}

async function handleRequest({ method, params }: { method: string; params: Record<string, unknown> }): Promise<unknown> {
    // Check rate limit for external API methods
    if (!checkRateLimit(method)) {
        throw new Error(`Rate limit exceeded for ${method}. Max ${RATE_LIMIT_PER_SECOND} requests per second.`);
    }

    // Runtime validation of page-supplied NIP-07 params (TS casts are compile-time only)
    if (method.startsWith('nip07_')) {
        validateNip07Params(method, params);
    }

    // Gate all NIP-07 methods behind the "Connect this site" allowlist
    if (method.startsWith('nip07_')) {
        const origin = params?.origin as string;
        if (!origin || !(await isDomainAllowed(origin))) {
            logActivity({ domain: origin || 'unknown', method: method.replace('nip07_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
    }

    // Read-only account guard — reject all NIP-07 signing operations before they
    // reach the signer queue / permission check / popup approval flow
    const NIP07_SIGNING_METHODS = ['nip07_signEvent', 'nip07_nip04Encrypt', 'nip07_nip04Decrypt', 'nip07_nip44Encrypt', 'nip07_nip44Decrypt'];
    if (NIP07_SIGNING_METHODS.includes(method) && await isActiveAccountReadOnly()) {
        logActivity({ domain: params?.origin as string, method: method.replace('nip07_', ''), decision: 'blocked' });
        throw new Error('Signing not available for read-only accounts');
    }

    // Normalize pubkey targets from npub to hex
    if (params?.target) params.target = npubToHex(params.target as string) || params.target;
    if (params?.from) params.from = npubToHex(params.from as string) || params.from;
    if (params?.to) params.to = npubToHex(params.to as string) || params.to;
    if (params?.pubkey) params.pubkey = npubToHex(params.pubkey as string) || params.pubkey;
    // For batch operations, keep a mapping from normalized→original for response keys
    let _batchKeyMap: Map<string, string> | null = null;
    if (Array.isArray(params?.targets)) {
        _batchKeyMap = new Map();
        params.targets = (params.targets as string[]).map(t => {
            const hex = npubToHex(t) || t;
            if (hex !== t) _batchKeyMap!.set(hex, t);
            return hex;
        });
    }
    if (Array.isArray(params?.pubkeys)) {
        if (!_batchKeyMap) _batchKeyMap = new Map();
        params.pubkeys = (params.pubkeys as string[]).map(t => {
            const hex = npubToHex(t) || t;
            if (hex !== t) _batchKeyMap!.set(hex, t);
            return hex;
        });
    }

    switch (method) {
        case 'getDistance':
            return getDistance(config.myPubkey!, params.target as string);

        case 'isInMyWoT': {
            const dist = await getDistance(config.myPubkey!, params.target as string);
            const hops = (params.maxHops as number) ?? config.maxHops;
            return dist !== null && dist <= hops;
        }

        case 'getTrustScore':
            return getTrustScore(config.myPubkey!, params.target as string);

        case 'getDetails':
            return getDetails(config.myPubkey!, params.target as string);

        case 'syncGraph':
            return syncGraph((params?.depth as number) || 2);

        case 'stopSync':
            stopSync();
            return { ok: true };

        case 'getSyncState':
            return {
                inProgress: isSyncInProgress(),
                state: await storage.getMeta('syncState')
            };

        case 'clearGraph':
            return clearGraph();

        case 'getStats':
            return storage.getStats();

        case 'getConfig':
            return {
                maxHops: config.maxHops,
                timeout: config.timeout,
                scoring: config.scoring
            };

        case 'getMyPubkey':
            return config.myPubkey;

        case 'getStatus':
            return {
                configured: !!config.myPubkey,
                mode: config.mode,
                hasLocalGraph: (await storage.getStats()).nodes > 0
            };

        case 'getDistanceBatch': {
            const batchResult = await getDistanceBatch(params.targets as string[], {
                includePaths: params.includePaths as boolean,
                includeScores: params.includeScores as boolean
            });
            // Remap hex keys back to original npub keys if needed
            if (_batchKeyMap?.size && batchResult) {
                const remapped: Record<string, unknown> = {};
                for (const [key, val] of Object.entries(batchResult)) {
                    remapped[_batchKeyMap.get(key) || key] = val;
                }
                return remapped;
            }
            return batchResult;
        }

        case 'getTrustScoreBatch': {
            const scoreResult = await getTrustScoreBatch(params.targets as string[]);
            if (_batchKeyMap?.size && scoreResult) {
                const remapped: Record<string, unknown> = {};
                for (const [key, val] of Object.entries(scoreResult)) {
                    remapped[_batchKeyMap.get(key) || key] = val;
                }
                return remapped;
            }
            return scoreResult;
        }

        case 'filterByWoT':
            return filterByWoT(params.pubkeys as string[], params.maxHops as number | undefined);

        case 'getFollows':
            return getFollowsForPubkey(params.pubkey as string);

        case 'getCommonFollows':
            return getCommonFollows(params.pubkey as string);

        case 'getPath':
            return getPathTo(params.target as string);

        case 'getNostrPubkey':
            return getNostrPubkeyFromActiveTab();

        case 'injectWotApi':
            return injectWotApi();

        case 'configUpdated':
            await loadConfig();
            refreshBadgesOnAllTabs();
            return { ok: true };

        case 'hasHostPermission':
            return hasHostPermission();

        case 'requestHostPermission':
            return requestHostPermission();

        // Per-domain permissions
        case 'getAllowedDomains':
            return getAllowedDomains();

        case 'isDomainAllowed':
            return isDomainAllowed(params.domain as string);

        case 'addAllowedDomain':
            return addAllowedDomain(params.domain as string);

        case 'removeAllowedDomain':
            return removeAllowedDomain(params.domain as string);

        case 'setBadgeDisabled':
            return setBadgeDisabled(params.domain as string, params.disabled as boolean);

        case 'removeBadgesFromTab':
            return removeBadgesFromTab(params.tabId as number);

        case 'getCustomAdapters': {
            const cData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
            return cData.customAdapters || {};
        }

        case 'saveCustomAdapter': {
            const caData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
            const cas = caData.customAdapters || {};
            cas[params.domain as string] = params.config as Record<string, unknown>;
            await browser.storage.local.set({ customAdapters: cas });
            return true;
        }

        case 'deleteCustomAdapter': {
            const daData = await browser.storage.local.get('customAdapters') as Record<string, Record<string, unknown>>;
            const das = daData.customAdapters || {};
            delete das[params.domain as string];
            await browser.storage.local.set({ customAdapters: das });
            return true;
        }

        case 'previewBadgeConfig': {
            // Temporarily inject the given config into matching tabs without persisting
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
                    // Also inject custom CSS for preview
                    const parts: string[] = [];
                    if (Array.isArray(previewConfig.strategies)) {
                        for (let i = 0; i < previewConfig.strategies.length; i++) {
                            const s = previewConfig.strategies[i] as Record<string, unknown>;
                            if (s.customCSS && s.enabled !== false) {
                                parts.push(sanitizeCSS(s.customCSS as string).replace(
                                    /\.wot-badge(?![-\w])/g,
                                    `.wot-badge[data-wot-strategy="${i}"]`
                                ));
                            }
                        }
                    }
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
        }

        case 'setIdentityDisabled':
            return setIdentityDisabled(params.domain as string, params.disabled as boolean);

        case 'getIdentityDisabledSites': {
            const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
            return data.identityDisabledSites || [];
        }

        case 'enableForCurrentDomain':
            return enableForCurrentDomain();

        // === Database management ===

        case 'listDatabases':
            return storage.listAllDatabases();

        case 'getDatabaseStats':
            return storage.getDatabaseStats(params.accountId as string);

        case 'deleteAccountDatabase': {
            await storage.deleteDatabase(params.accountId as string);
            localGraph = new LocalGraph();
            return { ok: true };
        }

        case 'deleteAllDatabases': {
            const dbs = await storage.listAllDatabases();
            for (const d of dbs) {
                await storage.deleteDatabase((d as Record<string, string>).accountId);
            }
            localGraph = new LocalGraph();
            return { ok: true };
        }

        // === Vault lifecycle ===

        case 'vault_unlock': {
            const unlockResult = await vault.unlock(params.password as string);
            if (unlockResult) {
                // Sync vault active account with storage.local (source of truth)
                const unlockData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
                if (unlockData.activeAccountId) {
                    try {
                        await vault.setActiveAccount(unlockData.activeAccountId);
                    } catch {
                        vault.clearActiveAccount();
                    }
                }
                await signer.onVaultUnlocked();
            }
            return unlockResult;
        }

        case 'vault_lock':
            vault.lock();
            return { ok: true };

        case 'vault_isLocked':
            return vault.isLocked();

        case 'vault_exists':
            return vault.exists();

        case 'vault_setAutoLock': {
            const prevMs = ((await browser.storage.local.get(['autoLockMs'])) as Record<string, number>).autoLockMs ?? 900000;
            const wasNever = prevMs === 0;
            const willBeNever = params.ms === 0;

            if (wasNever !== willBeNever) {
                // Switching to/from "Never" requires re-encrypting the vault
                const payload = vault.getDecryptedPayload();
                if (wasNever) {
                    // Never → Timed: need new password
                    if (!params.password || (params.password as string).length < 8) {
                        throw new Error('Password required (min 8 characters)');
                    }
                    await vault.create(params.password as string, payload!);
                } else {
                    // Timed → Never: re-encrypt with empty password (by design).
                    if (!params.currentPassword) {
                        throw new Error('Current password required');
                    }
                    const ok = await vault.unlock(params.currentPassword as string);
                    if (!ok) throw new Error('Current password is incorrect');
                    await vault.create('', payload!);
                }
            }

            vault.setAutoLockTimeout(params.ms as number);
            await browser.storage.local.set({ autoLockMs: params.ms });
            return { result: true };
        }

        case 'vault_getAutoLock': {
            const data = await browser.storage.local.get(['autoLockMs']) as Record<string, number>;
            return data.autoLockMs ?? 900000; // default 15 min
        }

        case 'vault_create':
            await vault.create(params.password as string, params.payload as VaultPayload);
            // Sync active pubkey to WoT config
            await syncActivePubkey();
            return { ok: true };

        case 'vault_listAccounts':
            return vault.listAccounts();

        case 'vault_addAccount': {
            await vault.addAccount(params.account as Account);
            // Sync to local accounts array
            const addLocalData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
            const addAccts = addLocalData.accounts || [];
            if (!addAccts.some(a => a.id === (params.account as Account).id)) {
                addAccts.push({
                    id: (params.account as Account).id,
                    name: (params.account as Account).name || 'Account',
                    pubkey: (params.account as Account).pubkey,
                    type: (params.account as Account).type || 'generated',
                    readOnly: !!(params.account as Account).readOnly
                });
                await browser.storage.local.set({ accounts: addAccts });
            }
            return { ok: true };
        }

        case 'vault_removeAccount': {
            const removedId = params.accountId as string;
            await vault.removeAccount(removedId);
            await signerPermissions.clearForAccount(removedId);
            await syncActivePubkey();
            // Remove from local accounts array (DB is kept — user can delete from settings)
            const rmLocalData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
            const rmAccts = ((rmLocalData.accounts as Array<{ id: string }>) || []).filter(a => a.id !== removedId);
            const updates: Record<string, unknown> = { accounts: rmAccts };
            if (rmLocalData.activeAccountId === removedId) {
                const newActive = vault.getActiveAccountId() || (rmAccts[0] as { id: string })?.id || null;
                updates.activeAccountId = newActive;
            }
            await browser.storage.local.set(updates);
            // Switch to the new active account's DB
            const newActiveId = (updates.activeAccountId ?? rmLocalData.activeAccountId) as string;
            if (newActiveId) {
                await storage.switchDatabase(newActiveId);
            }
            localGraph = new LocalGraph();
            return { ok: true };
        }

        case 'switchAccount': {
            if (isSyncInProgress()) {
                await stopSync();
            }
            const switchId = params.accountId as string;
            // Save old account ID for cleanup
            const oldData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            const oldAccountId = oldData.activeAccountId;
            // Update vault active account if vault is unlocked and account exists in vault
            try {
                await vault.setActiveAccount(switchId);
            } catch {
                vault.clearActiveAccount();
            }
            // Update storage and in-memory config
            const switchData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; pubkey: string }>>;
            const switchAcct = (switchData.accounts || []).find(a => a.id === switchId);
            const switchPubkey = switchAcct?.pubkey || vault.getActivePubkey();
            if (switchPubkey) {
                config.myPubkey = switchPubkey;
                await browser.storage.sync.set({ myPubkey: switchPubkey });
            }
            await browser.storage.local.set({ activeAccountId: switchId });
            // Switch database and recreate graph
            await storage.switchDatabase(switchId);
            localGraph = new LocalGraph();
            refreshBadgesOnAllTabs();
            // Reject pending requests for the old account
            if (oldAccountId && oldAccountId !== switchId) {
                await signer.rejectPendingForAccount(oldAccountId);
            }
            // Notify all tabs about the account change
            if (switchPubkey) {
                broadcastAccountChanged(switchPubkey);
            }
            return { ok: true };
        }

        case 'vault_setActiveAccount': {
            if (isSyncInProgress()) {
                await stopSync();
            }
            await vault.setActiveAccount(params.accountId as string);
            await syncActivePubkey();
            await storage.switchDatabase(params.accountId as string);
            localGraph = new LocalGraph();
            return { ok: true };
        }

        case 'vault_getActivePubkey':
            return vault.getActivePubkey();

        case 'vault_exportNsec': {
            const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            const privkeyBytes = vault.getPrivkey(exportData.activeAccountId);
            if (!privkeyBytes) throw new Error('No private key available');
            const nsec = nsecEncode(bytesToHex(privkeyBytes));
            privkeyBytes.fill(0);
            return nsec;
        }

        case 'vault_exportNcryptsec': {
            const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            const privkeyBytes = vault.getPrivkey(exportData.activeAccountId);
            if (!privkeyBytes) throw new Error('No private key available');
            try {
                const ncryptsec = await ncryptsecEncode(bytesToHex(privkeyBytes), params.password as string);
                return ncryptsec;
            } finally {
                privkeyBytes.fill(0);
            }
        }

        case 'vault_exportSeed': {
            if (vault.isLocked()) throw new Error('Vault is locked');
            const payload = vault.getDecryptedPayload();
            const activeId = (await browser.storage.local.get(['activeAccountId']) as Record<string, string>).activeAccountId;
            const activeAcct = payload.accounts.find(a => a.id === activeId);
            if (!activeAcct || activeAcct.type !== 'generated' || !activeAcct.mnemonic) {
                throw new Error('Active account has no seed phrase');
            }
            return { mnemonic: activeAcct.mnemonic, wordCount: activeAcct.mnemonic.split(' ').length };
        }

        case 'vault_importNcryptsec': {
            const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
            const acct = await accounts.importNsec(privkeyHex, params.name as string);
            const { privkey, mnemonic, ...safeAcct } = acct;
            return { account: safeAcct, pubkey: acct.pubkey };
        }

        case 'vault_changePassword': {
            const unlocked = await vault.unlock(params.currentPassword as string);
            if (!unlocked) throw new Error('Current password is incorrect');
            await vault.reEncrypt(params.newPassword as string);
            return { ok: true };
        }

        case 'vault_getActiveAccountType': {
            const typeData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
            const typeAccts = (typeData.accounts as Array<{ id: string; type?: string; readOnly?: boolean }>) || [];
            const typeActive = typeAccts.find(a => a.id === typeData.activeAccountId);
            if (typeActive) {
                return { type: typeActive.type || 'npub', readOnly: typeActive.readOnly !== false };
            }
            return null;
        }

        case 'getProfileMetadata':
            return fetchProfileMetadata(params.pubkey as string);

        case 'getProfileMetadataBatch': {
            const pubkeys = params.pubkeys as string[];
            if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');
            const results: Record<string, Record<string, unknown> | null> = {};
            await Promise.all(pubkeys.map(async (pk) => {
                results[pk] = await fetchProfileMetadata(pk);
            }));
            return results;
        }

        // === NIP-07 signer methods ===

        case 'nip07_getPublicKey': {
            const origin = params.origin as string;
            if (origin && await isIdentityDisabled(origin)) {
                logActivity({ domain: origin, method: 'getPublicKey', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleGetPublicKey(origin);
                logActivity({ domain: origin, method: 'getPublicKey', decision: 'approved' });
                if (origin) addAllowedDomain(origin).catch(() => {});
                return result;
            } catch (e) {
                logActivity({ domain: origin, method: 'getPublicKey', decision: 'rejected' });
                throw e;
            }
        }

        case 'nip07_signEvent': {
            if (params.origin && await isIdentityDisabled(params.origin as string)) {
                logActivity({ domain: params.origin as string, method: 'signEvent', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleSignEvent(params.event as UnsignedEvent, params.origin as string);
                logActivity({ domain: params.origin as string, method: 'signEvent', kind: (params.event as Record<string, unknown>)?.kind as number, decision: 'approved', event: params.event as Record<string, unknown> });
                if ((params.event as Record<string, unknown>)?.kind === 3) {
                    triggerAutoSyncIfEnabled();
                }
                return result;
            } catch (e) {
                logActivity({ domain: params.origin as string, method: 'signEvent', kind: (params.event as Record<string, unknown>)?.kind as number, decision: 'rejected', event: params.event as Record<string, unknown> });
                throw e;
            }
        }

        case 'nip07_getRelays': {
            const data = await browser.storage.sync.get('relays') as Record<string, string>;
            const relayList = data.relays ? data.relays.split(',').map(r => r.trim()).filter(Boolean) : [];
            const relayObj: Record<string, { read: boolean; write: boolean }> = {};
            for (const r of relayList) relayObj[r] = { read: true, write: true };
            return relayObj;
        }

        case 'nip07_nip04Encrypt': {
            if (params.origin && await isIdentityDisabled(params.origin as string)) {
                logActivity({ domain: params.origin as string, method: 'nip04Encrypt', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleNip04Encrypt(params.pubkey as string, params.plaintext as string, params.origin as string);
                logActivity({ domain: params.origin as string, method: 'nip04Encrypt', decision: 'approved', theirPubkey: params.pubkey as string });
                return result;
            } catch (e) {
                logActivity({ domain: params.origin as string, method: 'nip04Encrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
                throw e;
            }
        }

        case 'nip07_nip04Decrypt': {
            if (params.origin && await isIdentityDisabled(params.origin as string)) {
                logActivity({ domain: params.origin as string, method: 'nip04Decrypt', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleNip04Decrypt(params.pubkey as string, params.ciphertext as string, params.origin as string);
                logActivity({ domain: params.origin as string, method: 'nip04Decrypt', decision: 'approved', theirPubkey: params.pubkey as string });
                return result;
            } catch (e) {
                logActivity({ domain: params.origin as string, method: 'nip04Decrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
                throw e;
            }
        }

        case 'nip07_nip44Encrypt': {
            if (params.origin && await isIdentityDisabled(params.origin as string)) {
                logActivity({ domain: params.origin as string, method: 'nip44Encrypt', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleNip44Encrypt(params.pubkey as string, params.plaintext as string, params.origin as string);
                logActivity({ domain: params.origin as string, method: 'nip44Encrypt', decision: 'approved', theirPubkey: params.pubkey as string });
                return result;
            } catch (e) {
                logActivity({ domain: params.origin as string, method: 'nip44Encrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
                throw e;
            }
        }

        case 'nip07_nip44Decrypt': {
            if (params.origin && await isIdentityDisabled(params.origin as string)) {
                logActivity({ domain: params.origin as string, method: 'nip44Decrypt', decision: 'blocked' });
                throw new Error('Identity access disabled for this site');
            }
            try {
                const result = await signer.handleNip44Decrypt(params.pubkey as string, params.ciphertext as string, params.origin as string);
                logActivity({ domain: params.origin as string, method: 'nip44Decrypt', decision: 'approved', theirPubkey: params.pubkey as string });
                return result;
            } catch (e) {
                logActivity({ domain: params.origin as string, method: 'nip44Decrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
                throw e;
            }
        }

        // === Signer permission management ===

        case 'signer_getPermissions':
            return signerPermissions.getAll(params.accountId as string);

        case 'signer_getPermissionsForDomain':
            return signerPermissions.getForDomain(params.domain as string, params.accountId as string);

        case 'signer_clearPermissions':
            await signerPermissions.clear(params.domain as string, params.accountId as string);
            return { ok: true };

        case 'signer_savePermission':
            await signerPermissions.saveDirect(params.domain as string, params.methodName as string, params.decision as 'allow' | 'deny' | 'ask', params.accountId as string);
            return { ok: true };

        case 'signer_getPermissionsRaw':
            return signerPermissions.getAllRaw();

        case 'signer_getPermissionsForDomainRaw':
            return signerPermissions.getForDomainRaw(params.domain as string);

        case 'signer_copyPermissions':
            await signerPermissions.copyPermissions(params.fromAccountId as string, params.toAccountId as string);
            return { ok: true };

        case 'signer_getUseGlobalDefaults':
            return signerPermissions.getUseGlobalDefaults();

        case 'signer_setUseGlobalDefaults':
            await signerPermissions.setUseGlobalDefaults(params.enabled as boolean);
            return { ok: true };

        // === Signer pending request management ===

        case 'signer_getPending': {
            return signer.getPending();
        }

        case 'signer_resolve':
            signer.resolveRequest(params.id as string, params.decision as unknown as import('./lib/types.ts').RequestDecision);
            return { ok: true };

        case 'signer_resolveBatch':
            await signer.resolveBatch(params.origin as string, params.method as string, params.decision as unknown as import('./lib/types.ts').RequestDecision, params.eventKind as number | undefined);
            return { ok: true };

        // === Onboarding methods ===

        case 'onboarding_validateNsec': {
            const acct = await accounts.importNsec(params.input as string);
            const { privkey, mnemonic, ...safeAcct } = acct;

            // Check if this pubkey already has an encrypted private key in the vault
            const localAccts = ((await browser.storage.local.get(['accounts'])) as Record<string, Array<{ pubkey: string; id: string }>>).accounts || [];
            const existing = localAccts.find(a => a.pubkey === acct.pubkey);
            let hasEncryptedKey = false;
            if (existing && await vault.exists() && !vault.isLocked()) {
                hasEncryptedKey = vault.listAccounts().some(
                    a => a.pubkey === acct.pubkey && !a.readOnly
                );
            }
            if (hasEncryptedKey) {
                throw new Error('This account is already added with full signing access.');
            }

            await setPendingOnboardingAccount(acct);

            return {
                account: safeAcct,
                pubkey: acct.pubkey,
                npub: npubEncode(acct.pubkey),
                upgradeFromReadOnly: existing && !hasEncryptedKey ? existing.id : null
            };
        }

        case 'onboarding_validateNcryptsec': {
            const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
            const acct = await accounts.importNsec(privkeyHex, params.name as string);
            const { privkey: _pk, mnemonic: _mn, ...safeAcct } = acct;

            const localAccts2 = ((await browser.storage.local.get(['accounts'])) as Record<string, Array<{ pubkey: string; id: string }>>).accounts || [];
            const existing2 = localAccts2.find(a => a.pubkey === acct.pubkey);
            let hasEncryptedKey2 = false;
            if (existing2 && await vault.exists() && !vault.isLocked()) {
                hasEncryptedKey2 = vault.listAccounts().some(
                    a => a.pubkey === acct.pubkey && !a.readOnly
                );
            }
            if (hasEncryptedKey2) {
                throw new Error('This account is already added with full signing access.');
            }

            await setPendingOnboardingAccount(acct);

            return {
                account: safeAcct,
                pubkey: acct.pubkey,
                npub: npubEncode(acct.pubkey),
                upgradeFromReadOnly: existing2 && !hasEncryptedKey2 ? existing2.id : null
            };
        }

        case 'onboarding_validateMnemonic': {
            const mnemonic = (params.mnemonic as string).trim().toLowerCase().replace(/\s+/g, ' ');
            // Determine if vault already has a seed
            let hasSeed = false;
            if (await vault.exists() && !vault.isLocked()) {
                try {
                    const payload = vault.getDecryptedPayload();
                    hasSeed = payload.accounts.some(a => a.type === 'generated' && a.mnemonic);
                } catch { /* ignore */ }
            }
            // If no existing seed: import as main (type 'generated', mnemonic stored)
            // If existing seed: import only the first derived key (type 'nsec', no mnemonic stored)
            const acct = hasSeed
                ? await accounts.importFromMnemonicDerived(mnemonic)
                : await accounts.createFromMnemonic(mnemonic, 'Imported');
            const { privkey, mnemonic: _mn, ...safeAcct } = acct;

            // Check for duplicate / read-only upgrade
            const localAccts3 = ((await browser.storage.local.get(['accounts'])) as Record<string, Array<{ pubkey: string; id: string }>>).accounts || [];
            const existing3 = localAccts3.find(a => a.pubkey === acct.pubkey);
            let hasEncryptedKey3 = false;
            if (existing3 && await vault.exists() && !vault.isLocked()) {
                hasEncryptedKey3 = vault.listAccounts().some(
                    a => a.pubkey === acct.pubkey && !a.readOnly
                );
            }
            if (hasEncryptedKey3) {
                throw new Error('This account is already added with full signing access.');
            }

            await setPendingOnboardingAccount(acct);

            return {
                account: safeAcct,
                pubkey: acct.pubkey,
                npub: npubEncode(acct.pubkey),
                upgradeFromReadOnly: existing3 && !hasEncryptedKey3 ? existing3.id : null,
                importedAsMain: !hasSeed,
            };
        }

        case 'onboarding_validateNpub': {
            const acct = accounts.importNpub(params.input as string);
            return { account: acct, pubkey: acct.pubkey };
        }

        case 'onboarding_connectNip46': {
            const acct = accounts.connectNip46(params.bunkerUrl as string);
            return { account: acct };
        }

        case 'onboarding_initNostrConnect': {
            const relay = DEFAULT_RELAYS[0];
            const connectSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
            const client = new Nip46Client({ pubkey: null, relay, secret: null, connectSecret });
            await client.init();
            const { privkey: localPrivkey, pubkey: localPubkey } = client.getLocalKeyPair();
            const nostrconnectUri = Nip46Client.buildConnectUri(localPubkey, relay, {
                name: 'Nostr WoT Extension'
            }) + `&secret=${connectSecret}`;
            await client.connect();

            const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
            const session: NostrConnectSession = { client, relay, localPrivkey, localPubkey, signerPubkey: null, connected: false, expired: false };
            _nostrConnectSessions.set(sessionId, session);

            // Start listening in the background
            client.listenForConnect(120000).then(signerPubkey => {
                session.signerPubkey = signerPubkey;
                session.connected = true;
            }).catch(() => {
                session.expired = true;
            });

            return { nostrconnectUri, sessionId };
        }

        case 'onboarding_pollNostrConnect': {
            const session = _nostrConnectSessions.get(params.sessionId as string);
            if (!session) return { expired: true };
            if (session.connected) {
                const acct = accounts.connectNostrConnect(
                    session.signerPubkey!, session.relay,
                    session.localPrivkey, session.localPubkey
                );
                _nostrConnectSessions.delete(params.sessionId as string);
                session.client.close();
                return { connected: true, account: acct };
            }
            if (session.expired) {
                _nostrConnectSessions.delete(params.sessionId as string);
                session.client.close();
                return { expired: true };
            }
            return { connected: false };
        }

        case 'onboarding_cancelNostrConnect': {
            const session2 = _nostrConnectSessions.get(params.sessionId as string);
            if (session2) {
                session2.client.close();
                _nostrConnectSessions.delete(params.sessionId as string);
            }
            return { ok: true };
        }

        case 'onboarding_generateAccount': {
            const { account: acct, mnemonic } = await accounts.generateNewAccount();
            const { privkey, ...safeAcct } = acct;
            await setPendingOnboardingAccount(acct);
            return { account: safeAcct, mnemonic };
        }

        case 'onboarding_checkExistingSeed': {
            if (vault.isLocked()) return { hasSeed: false };
            try {
                const payload = vault.getDecryptedPayload();
                const generated = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
                return { hasSeed: !!generated };
            } catch {
                return { hasSeed: false };
            }
        }

        case 'onboarding_generateSubAccount': {
            if (vault.isLocked()) throw new Error('Vault is locked');
            const payload = vault.getDecryptedPayload();
            const seedAccount = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
            if (!seedAccount || !seedAccount.mnemonic) {
                throw new Error('No existing seed account found');
            }
            // Determine next derivation index: max existing index + 1
            const maxIndex = payload.accounts
                .filter(a => a.type === 'generated' && a.mnemonic === seedAccount.mnemonic)
                .reduce((max, a) => Math.max(max, a.derivationIndex ?? 0), 0);
            const nextIndex = maxIndex + 1;
            const subAcct = await accounts.createFromMnemonicAtIndex(
                seedAccount.mnemonic,
                nextIndex,
                (params.name as string) || undefined
            );
            const { privkey: _pk, ...safeSubAcct } = subAcct;
            await setPendingOnboardingAccount(subAcct);
            return { account: safeSubAcct, derivationIndex: nextIndex };
        }

        case 'onboarding_exportNcryptsec': {
            const pendingAcctEnc = await getPendingOnboardingAccount();
            if (!pendingAcctEnc?.privkey) throw new Error('No pending account');
            const ncryptsec = await ncryptsecEncode(pendingAcctEnc.privkey, params.password as string);
            return ncryptsec;
        }

        case 'onboarding_saveReadOnly': {
            const acctId = (params.account as Record<string, string>).id;
            const pubkey = (params.account as Record<string, string>).pubkey;
            const acctType = (params.account as Record<string, string>).type || 'npub';
            if (pubkey) {
                config.myPubkey = pubkey;
                await browser.storage.sync.set({ myPubkey: pubkey });
            }
            const localAccts = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
            const accts = localAccts.accounts || [];
            if (!accts.some(a => a.id === acctId)) {
                // NIP-46 accounts can sign via remote signer — not read-only
                accts.push({
                    id: acctId,
                    name: (params.account as Record<string, string>).name || 'Account',
                    pubkey,
                    type: acctType,
                    readOnly: acctType !== 'nip46'
                });
            }
            await browser.storage.local.set({ accounts: accts, activeAccountId: acctId });
            await storage.switchDatabase(acctId);
            localGraph = new LocalGraph();
            return { ok: true };
        }

        case 'onboarding_createVault': {
            const pendingAcct = await getPendingOnboardingAccount();
            const fullAccount = pendingAcct && pendingAcct.id === (params.account as Record<string, string>).id
                ? pendingAcct
                : params.account as Account;
            if (!fullAccount.privkey && fullAccount.type !== 'npub' && fullAccount.type !== 'nip46') {
                throw new Error('Cannot create vault: private key was lost. Please re-import your nsec.');
            }
            await setPendingOnboardingAccount(null);

            const payload = {
                accounts: [fullAccount],
                activeAccountId: fullAccount.id
            };
            await vault.create(params.password as string, payload);
            if (params.autoLockMinutes !== undefined) {
                vault.setAutoLockTimeout((params.autoLockMinutes as number) * 60 * 1000);
                await browser.storage.local.set({ autoLockMs: (params.autoLockMinutes as number) * 60 * 1000 });
            }
            await syncActivePubkey();
            const vaultAcctId = fullAccount.id;
            const localAccts = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
            let accts = localAccts.accounts || [];
            if (params.upgradeFromReadOnly) {
                accts = accts.filter(a => a.id !== params.upgradeFromReadOnly);
            }
            if (!accts.some(a => a.id === vaultAcctId)) {
                accts.push({
                    id: vaultAcctId,
                    name: fullAccount.name || 'Account',
                    pubkey: fullAccount.pubkey,
                    type: fullAccount.type || 'generated',
                    readOnly: !fullAccount.privkey && fullAccount.type !== 'nip46'
                });
            } else {
                // Update readOnly in case account was saved earlier with wrong flag
                const idx = accts.findIndex(a => a.id === vaultAcctId);
                if (idx !== -1) accts[idx].readOnly = !fullAccount.privkey && fullAccount.type !== 'nip46';
            }
            await browser.storage.local.set({ accounts: accts, activeAccountId: vaultAcctId });
            await storage.switchDatabase((params.upgradeFromReadOnly as string) || vaultAcctId);
            localGraph = new LocalGraph();
            return { ok: true };
        }

        case 'onboarding_addToVault': {
            if (vault.isLocked()) throw new Error('Vault is locked');

            const pendingAcctAdd = await getPendingOnboardingAccount();
            const fullAccountAdd = pendingAcctAdd && pendingAcctAdd.id === (params.account as Record<string, string>).id
                ? pendingAcctAdd
                : params.account as Account;
            if (!fullAccountAdd.privkey && fullAccountAdd.type !== 'npub' && fullAccountAdd.type !== 'nip46') {
                throw new Error('Cannot add account: private key was lost. Please re-import.');
            }
            await setPendingOnboardingAccount(null);

            await vault.addAccount(fullAccountAdd);
            await vault.setActiveAccount(fullAccountAdd.id);
            await syncActivePubkey();

            const addVaultLocalData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
            let addVaultAccts = addVaultLocalData.accounts || [];
            if (params.upgradeFromReadOnly) {
                addVaultAccts = addVaultAccts.filter(a => a.id !== params.upgradeFromReadOnly);
            }
            if (!addVaultAccts.some(a => a.id === fullAccountAdd.id)) {
                addVaultAccts.push({
                    id: fullAccountAdd.id,
                    name: fullAccountAdd.name || 'Account',
                    pubkey: fullAccountAdd.pubkey,
                    type: fullAccountAdd.type || 'generated',
                    readOnly: !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46'
                });
            } else {
                const idx = addVaultAccts.findIndex(a => a.id === fullAccountAdd.id);
                if (idx !== -1) addVaultAccts[idx].readOnly = !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46';
            }
            await browser.storage.local.set({ accounts: addVaultAccts, activeAccountId: fullAccountAdd.id });
            if (isSyncInProgress()) {
                await stopSync();
            }
            await storage.switchDatabase((params.upgradeFromReadOnly as string) || fullAccountAdd.id);
            localGraph = new LocalGraph();
            refreshBadgesOnAllTabs();
            if (fullAccountAdd.pubkey) {
                broadcastAccountChanged(fullAccountAdd.pubkey);
            }
            return { ok: true };
        }

        case 'getActivityLog': {
            const logData = await browser.storage.local.get(['activityLog']) as Record<string, unknown[]>;
            return logData.activityLog || [];
        }

        case 'clearActivityLog': {
            const hasFilter = params.domain || params.accountPubkey || params.typeFilter || params.pubkeyFilter;
            if (!hasFilter) {
                await browser.storage.local.remove('activityLog');
            } else {
                const allLog = ((await browser.storage.local.get(['activityLog'])) as Record<string, any[]>).activityLog || [];
                const typeMethods: Record<string, string[]> = {
                    signEvent: ['signEvent'], getPublicKey: ['getPublicKey'],
                    encrypt: ['nip04Encrypt', 'nip44Encrypt'], decrypt: ['nip04Decrypt', 'nip44Decrypt'],
                    nip04Encrypt: ['nip04Encrypt'], nip04Decrypt: ['nip04Decrypt'],
                    nip44Encrypt: ['nip44Encrypt'], nip44Decrypt: ['nip44Decrypt'],
                };
                const kept = allLog.filter((e: any) => {
                    if (params.accountPubkey && e.pubkey !== params.accountPubkey) return true;
                    if (params.domain && e.domain !== params.domain) return true;
                    if (params.typeFilter) {
                        const methods = typeMethods[params.typeFilter as string];
                        if (methods && !methods.includes(e.method)) return true;
                    }
                    if (params.pubkeyFilter) {
                        const q = (params.pubkeyFilter as string).toLowerCase();
                        let matches = false;
                        if (e.theirPubkey && e.theirPubkey.toLowerCase().includes(q)) matches = true;
                        if (!matches && e.event?.tags) {
                            for (const tag of e.event.tags) {
                                if (tag[0] === 'p' && tag[1] && tag[1].toLowerCase().includes(q)) { matches = true; break; }
                            }
                        }
                        if (!matches) return true;
                    }
                    return false; // matched all filters — remove
                });
                await browser.storage.local.set({ activityLog: kept });
            }
            return { ok: true };
        }

        // === Local Blocks ===

        case 'getLocalBlocks': {
            const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string }>>;
            return blockData.localBlocks || [];
        }

        case 'addLocalBlock': {
            const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string; note: string; addedAt: number }>>;
            const blocks = blockData.localBlocks || [];
            const pubkey = params.pubkey as string;
            if (!pubkey || blocks.some(b => b.pubkey === pubkey)) return { ok: false, error: 'Already blocked or invalid' };
            blocks.push({ pubkey, note: (params.note as string) || '', addedAt: Date.now() });
            await browser.storage.local.set({ localBlocks: blocks });
            return { ok: true };
        }

        case 'removeLocalBlock': {
            const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string }>>;
            const blocks = (blockData.localBlocks || []).filter(b => b.pubkey !== params.pubkey);
            await browser.storage.local.set({ localBlocks: blocks });
            return { ok: true };
        }

        // === Mute Lists ===

        case 'fetchMuteList': {
            const pubkeys = await fetchMuteList(params.pubkey as string, config.relays);
            if (pubkeys === null) return { ok: false, error: 'Could not fetch mute list' };
            return { ok: true, count: pubkeys.length, pubkeys };
        }

        case 'getMuteLists': {
            const data = await browser.storage.local.get(['muteLists']) as Record<string, unknown[]>;
            return data.muteLists || [];
        }

        case 'removeMuteList': {
            const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string }>>;
            const lists = (data.muteLists || []).filter(l => l.pubkey !== params.pubkey);
            await browser.storage.local.set({ muteLists: lists });
            return { ok: true };
        }

        case 'toggleMuteList': {
            const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string; enabled: boolean }>>;
            const lists = data.muteLists || [];
            const list = lists.find(l => l.pubkey === params.pubkey);
            if (list) {
                list.enabled = !list.enabled;
                await browser.storage.local.set({ muteLists: lists });
            }
            return { ok: true };
        }

        case 'saveMuteList': {
            const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string; name: string; entries: unknown; enabled: boolean; syncedAt: number }>>;
            const lists = data.muteLists || [];
            if (lists.some(l => l.pubkey === params.pubkey)) return { ok: false, error: 'Already imported' };
            lists.push({
                pubkey: params.pubkey as string,
                name: (params.name as string) || (params.pubkey as string).slice(0, 8) + '...',
                entries: params.entries,
                enabled: true,
                syncedAt: Date.now()
            });
            await browser.storage.local.set({ muteLists: lists });
            return { ok: true };
        }

        // === NIP-46 Session Management ===

        case 'nip46_getSessionInfo': {
            const nip46Data = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            const nip46Acct = nip46Data.activeAccountId
                ? vault.getAccountById(nip46Data.activeAccountId)
                : null;
            if (!nip46Acct || nip46Acct.type !== 'nip46') return null;

            const nip46Config = nip46Acct.nip46Config;
            if (!nip46Config) return null;

            const clientConnected = signer.isNip46Connected(nip46Acct.id);

            return {
                bunkerPubkey: nip46Config.bunkerUrl ? new URL('nostr://' + nip46Config.bunkerUrl.replace('bunker://', '')).pathname.slice(2, 66) : null,
                relay: nip46Config.relay,
                connected: clientConnected,
                accountId: nip46Acct.id,
                accountName: nip46Acct.name
            };
        }

        case 'nip46_revokeSession': {
            signer.disconnectNip46(params.accountId as string);
            return { ok: true };
        }

        case 'publishRelayList': {
            const privkeyBytes = vault.getPrivkey();
            if (!privkeyBytes) throw new Error('Vault is locked or no private key');

            try {
                const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
                const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
                const relaysCsv = relayData.relays || '';
                const relayUrls = relaysCsv.split(',').map(r => r.trim()).filter(Boolean);
                const flags = flagData.relayFlags || {};

                const tags: string[][] = [];
                for (const url of relayUrls) {
                    const f = flags[url] || { read: true, write: true };
                    if (f.read && f.write) {
                        tags.push(['r', url]);
                    } else if (f.read) {
                        tags.push(['r', url, 'read']);
                    } else if (f.write) {
                        tags.push(['r', url, 'write']);
                    }
                }

                const event: UnsignedEvent = {
                    created_at: Math.floor(Date.now() / 1000),
                    kind: 10002,
                    tags,
                    content: ''
                };

                const signed = await signEvent(event, privkeyBytes);
                privkeyBytes.fill(0);

                const broadcastUrls = relayUrls.length > 0 ? relayUrls : config.relays;
                const result = await broadcastEvent(signed, broadcastUrls);

                await browser.storage.local.set({
                    lastRelayPublish: Date.now(),
                    lastPublishedRelays: relaysCsv
                });

                return { ok: true, sent: result.sent, failed: result.failed };
            } catch (e) {
                privkeyBytes.fill(0);
                throw e;
            }
        }

        case 'signEvent': {
            if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
            const privkeyBytes = vault.getPrivkey();
            if (!privkeyBytes) throw new Error('Vault is locked');
            try {
                return await signEvent(params.event as UnsignedEvent, privkeyBytes);
            } finally {
                privkeyBytes.fill(0);
            }
        }

        case 'signAndPublishEvent': {
            if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
            const privkeyBytes = vault.getPrivkey();
            if (!privkeyBytes) throw new Error('Vault is locked');
            try {
                const signed = await signEvent(params.event as UnsignedEvent, privkeyBytes);
                const result = await broadcastEvent(signed, config.relays);
                if ((params.event as UnsignedEvent).kind === 3) {
                    triggerAutoSyncIfEnabled();
                }
                return { ok: true, sent: result.sent, failed: result.failed };
            } finally {
                privkeyBytes.fill(0);
            }
        }

        case 'updateProfileCache': {
            const { pubkey, metadata } = params as { pubkey: string; metadata: Record<string, unknown> };
            if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata');
            const entry = { metadata, fetchedAt: Date.now() };
            profileCache.set(pubkey, entry);
            await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
            const pcData = await browser.storage.local.get('profileCache') as Record<string, Record<string, unknown>>;
            const pc = pcData.profileCache || {};
            pc[pubkey] = metadata;
            await browser.storage.local.set({ profileCache: pc });
            return { ok: true };
        }

        case 'checkRelayHealth': {
            const { url } = params as { url: string };
            try {
                const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
                const res = await fetch(httpUrl, {
                    headers: { 'Accept': 'application/nostr+json' },
                    signal: AbortSignal.timeout(5000)
                });
                return { reachable: res.ok };
            } catch {
                return { reachable: false };
            }
        }

        case 'checkOracleHealth': {
            const { url } = params as { url: string };
            try {
                const o = new RemoteOracle(url);
                const healthy = await o.isHealthy();
                return { reachable: healthy };
            } catch {
                return { reachable: false };
            }
        }

        default:
            throw new Error(`Unknown method: ${method}`);
    }
}

// Sync the active vault account pubkey to WoT config
async function syncActivePubkey(): Promise<void> {
    const pubkey = vault.getActivePubkey();
    if (pubkey) {
        config.myPubkey = pubkey;
        await browser.storage.sync.set({ myPubkey: pubkey });
    } else {
        config.myPubkey = '';
        await browser.storage.sync.remove('myPubkey');
    }
}

// ── Activity Log ──

async function logActivity(entry: ActivityEntry): Promise<void> {
    try {
        const data = await browser.storage.local.get(['activityLog']) as Record<string, Array<Record<string, unknown>>>;
        const log = data.activityLog || [];
        log.unshift({
            timestamp: Date.now(),
            domain: entry.domain,
            method: entry.method,
            kind: entry.kind ?? null,
            decision: entry.decision,
            pubkey: config.myPubkey || null,
            ...(entry.event && { event: entry.event }),
            ...(entry.theirPubkey && { theirPubkey: entry.theirPubkey }),
        });
        // Keep max 200 entries per domain
        const domainCounts: Record<string, number> = {};
        const trimmed = log.filter((e) => {
            const d = (e.domain as string) || '?';
            domainCounts[d] = (domainCounts[d] || 0) + 1;
            return domainCounts[d] <= 200;
        });
        await browser.storage.local.set({ activityLog: trimmed });
    } catch { /* ignored */ }
}

// ── Event Broadcasting ──

async function broadcastEvent(signedEvent: SignedEvent, relayUrls: string[]): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const promises = relayUrls.map(url => new Promise<void>((resolve) => {
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch { /* ignored */ }
                results.failed++;
                resolve();
            }, 5000);

            ws.onopen = () => {
                try {
                    ws.send(JSON.stringify(['EVENT', signedEvent]));
                } catch {
                    clearTimeout(timeout);
                    results.failed++;
                    resolve();
                    return;
                }
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg[0] === 'OK' && msg[1] === signedEvent.id) {
                        clearTimeout(timeout);
                        if (msg[2] === true) results.sent++;
                        else results.failed++;
                        try { ws.close(); } catch { /* ignored */ }
                        resolve();
                    }
                } catch { /* ignored */ }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                results.failed++;
                resolve();
            };
        } catch {
            results.failed++;
            resolve();
        }
    }));

    await Promise.all(promises);
    return results;
}

async function getDistance(from: string, to: string): Promise<number | null> {
    if (!from) throw new Error('My pubkey not configured');

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        return localGraph!.getDistance(from, to, config.maxHops);
    }

    if (config.mode === 'remote') {
        return oracle!.getDistance(from, to);
    }

    // Hybrid: try local first, fall back to remote
    await localGraph!.ensureReady();
    const local = await localGraph!.getDistance(from, to, config.maxHops);
    if (local !== null) return local;
    return oracle!.getDistance(from, to);
}

// Get detailed distance info (with path count and trust score)
async function getDetails(from: string, to: string): Promise<{ hops: number; paths: number | null; score: number } | null> {
    if (!from) throw new Error('My pubkey not configured');

    let info: DistanceInfo | null;

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        info = await localGraph!.getDistanceInfo(from, to, config.maxHops);
    } else if (config.mode === 'remote') {
        info = await oracle!.getDistanceInfo(from, to);
    } else {
        await localGraph!.ensureReady();
        info = await localGraph!.getDistanceInfo(from, to, config.maxHops);
        if (info === null) {
            info = await oracle!.getDistanceInfo(from, to);
        }
    }

    if (!info) return null;

    const hops = info.hops;
    const paths = info.paths ?? null;
    const score = calculateScore(hops, paths, config.scoring);

    return { hops, paths, score };
}

// Calculate trust score based on distance and scoring config
async function getTrustScore(from: string, to: string): Promise<number | null> {
    if (!from) throw new Error('My pubkey not configured');

    const details = await getDetails(from, to);
    if (!details || details.hops === null) return null;

    return details.score;
}

async function triggerAutoSyncIfEnabled(): Promise<void> {
    try {
        const data = await browser.storage.sync.get(['autoSyncOnFollowChange']) as Record<string, boolean>;
        if (!data.autoSyncOnFollowChange) return;
        if (isSyncInProgress()) return;
        syncGraph(2);
    } catch (e: unknown) {
        console.warn('[WOT] Auto-sync trigger failed:', (e as Error).message);
    }
}

async function syncGraph(depth: number): Promise<unknown> {
    if (!config.myPubkey) {
        throw new Error('My pubkey not configured');
    }

    if (config.relays.length === 0) {
        throw new Error('No relays configured');
    }

    const localData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
    if (localData.activeAccountId) {
        await storage.initDB(localData.activeAccountId);
    }

    const sync = new GraphSync(config.relays);

    sync.onProgress = (progress: unknown) => {
        browser.runtime.sendMessage({
            type: 'syncProgress',
            progress
        }).catch(() => {});
    };

    return await sync.syncFromPubkey(config.myPubkey, depth);
}

async function clearGraph(): Promise<{ ok: boolean }> {
    await storage.clearAll();
    return { ok: true };
}

async function getDistanceBatch(targets: string[], options: BatchOptions = {}): Promise<Record<string, unknown>> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    const opts: BatchOptions = typeof options === 'boolean'
        ? { includePaths: options, includeScores: false }
        : { includePaths: false, includeScores: false, ...options };

    const { includePaths, includeScores } = opts;
    const needDetails = includePaths || includeScores;

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        const results = await localGraph!.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);
        return formatBatchResults(results, opts);
    }

    if (config.mode === 'remote') {
        if (needDetails) {
            const results = await getDetailsBatchRemote(targets);
            return formatBatchResultsFromDetails(results, opts);
        }
        return oracle!.getDistanceBatch(config.myPubkey, targets);
    }

    // Hybrid: try local first, then remote for missing
    await localGraph!.ensureReady();
    const localResults = await localGraph!.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);

    const obj: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const [pubkey, info] of localResults) {
        if (info !== null) {
            obj[pubkey] = formatSingleResult(info as DistanceInfo, opts);
        } else {
            missing.push(pubkey);
        }
    }

    if (missing.length > 0) {
        try {
            if (needDetails) {
                const remoteResults = await getDetailsBatchRemote(missing);
                for (const [pubkey, details] of Object.entries(remoteResults)) {
                    obj[pubkey] = details ? formatSingleResult(details as DistanceInfo, opts) : null;
                }
            } else {
                const remoteResults = await oracle!.getDistanceBatch(config.myPubkey, missing);
                for (const [pubkey, hops] of Object.entries(remoteResults)) {
                    obj[pubkey] = hops;
                }
            }
        } catch {
            for (const pubkey of missing) {
                obj[pubkey] = null;
            }
        }
    }

    return obj;
}

function formatSingleResult(info: DistanceInfo, opts: BatchOptions): unknown {
    const { includePaths, includeScores } = opts;

    if (!includePaths && !includeScores) {
        return info.hops;
    }

    const result: Record<string, unknown> = { hops: info.hops };

    if (includePaths) {
        result.paths = info.paths ?? null;
    }

    if (includeScores) {
        result.score = calculateScore(info.hops, info.paths ?? null, config.scoring);
    }

    return result;
}

function formatBatchResults(results: Map<string, DistanceInfo | null>, opts: BatchOptions): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [pubkey, info] of results) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

function formatBatchResultsFromDetails(results: Record<string, DistanceInfo | null>, opts: BatchOptions): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [pubkey, info] of Object.entries(results)) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

async function getDetailsBatchRemote(targets: string[]): Promise<Record<string, DistanceInfo | null>> {
    const results: Record<string, DistanceInfo | null> = {};
    const CONCURRENCY = 5;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (target): Promise<[string, DistanceInfo | null]> => {
            try {
                const info = await oracle!.getDistanceInfo(config.myPubkey!, target);
                return [target, info ? { hops: info.hops, paths: info.paths ?? null } : null];
            } catch {
                return [target, null];
            }
        });
        const batchResults = await Promise.all(promises);
        for (const [pubkey, details] of batchResults) {
            results[pubkey] = details;
        }
    }
    return results;
}

async function getTrustScoreBatch(targets: string[]): Promise<Record<string, number | null>> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    const results = await getDistanceBatch(targets, { includePaths: true, includeScores: true });
    const scores: Record<string, number | null> = {};

    for (const [pubkey, info] of Object.entries(results)) {
        scores[pubkey] = info ? (info as { score: number }).score : null;
    }

    return scores;
}

async function filterByWoT(pubkeys: string[], maxHops?: number): Promise<string[]> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');

    const hops = maxHops ?? config.maxHops;
    const distances = await getDistanceBatch(pubkeys);

    return pubkeys.filter(pubkey => {
        const dist = distances[pubkey] as number | null;
        return dist !== null && dist <= hops;
    });
}

async function getFollowsForPubkey(pubkey: string): Promise<string[]> {
    const targetPubkey = pubkey || config.myPubkey;
    if (!targetPubkey) throw new Error('No pubkey specified');

    if (config.mode === 'remote') {
        return oracle!.getFollows(targetPubkey);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getFollows(targetPubkey);
        if (local && local.length > 0) return local;
        return oracle!.getFollows(targetPubkey);
    }

    await localGraph!.ensureReady();
    return localGraph!.getFollows(targetPubkey);
}

async function getCommonFollows(targetPubkey: string): Promise<string[]> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!targetPubkey) throw new Error('No target pubkey specified');

    if (config.mode === 'remote') {
        return oracle!.getCommonFollows(config.myPubkey, targetPubkey);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getCommonFollows(config.myPubkey, targetPubkey);
        if (local && local.length > 0) return local;
        return oracle!.getCommonFollows(config.myPubkey, targetPubkey);
    }

    await localGraph!.ensureReady();
    return localGraph!.getCommonFollows(config.myPubkey, targetPubkey);
}

async function getPathTo(target: string): Promise<string[] | null> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!target) throw new Error('No target specified');

    if (config.mode === 'remote') {
        return oracle!.getPath(config.myPubkey, target);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getPath(config.myPubkey, target, config.maxHops);
        if (local) return local;
        return oracle!.getPath(config.myPubkey, target);
    }

    await localGraph!.ensureReady();
    return localGraph!.getPath(config.myPubkey, target, config.maxHops);
}

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

        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
            return { ok: false, error: 'Cannot inject on this page' };
        }

        return { ok: true, url: tab.url };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// ── Profile metadata (Kind 0) fetching ──

const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 min
interface ProfileCacheEntry { metadata: Record<string, unknown>; fetchedAt: number; }
const profileCache = new Map<string, ProfileCacheEntry>();

async function fetchProfileMetadata(pubkey: string): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null;

    const cached = profileCache.get(pubkey);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
        return cached.metadata;
    }

    const storageKey = `profile_${pubkey}`;
    const stored = await browser.storage.local.get(storageKey) as Record<string, ProfileCacheEntry>;
    if (stored[storageKey] && Date.now() - stored[storageKey].fetchedAt < PROFILE_CACHE_TTL) {
        profileCache.set(pubkey, stored[storageKey]);
        return stored[storageKey].metadata;
    }

    const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
    const metadata = await fetchKind0(pubkey, relays);

    if (metadata) {
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [storageKey]: entry });
    }

    return metadata;
}

function fetchKind0(pubkey: string, relayUrls: string[]): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        let best: Record<string, unknown> | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(best); }
        };

        const timer = setTimeout(done, 5000);

        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'p' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
                let closed = false;

                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey !== pubkey || event.kind !== 0) return;
                            if (event.created_at > bestCreatedAt) {
                                bestCreatedAt = event.created_at;
                                best = JSON.parse(event.content);
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignore parse errors */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 4000);
            } catch {
                checkRemaining();
            }
        }
    });
}

function fetchMuteList(pubkey: string, relayUrls: string[]): Promise<string[] | null> {
    return new Promise((resolve) => {
        let bestTags: string[] | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(bestTags); }
        };
        const timer = setTimeout(done, 8000);
        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'm' + Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');
                let closed = false;
                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [10000], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey === pubkey && event.kind === 10000 && event.created_at > bestCreatedAt) {
                                bestCreatedAt = event.created_at;
                                bestTags = (event.tags || []).filter((t: string[]) => t[0] === 'p' && t[1]).map((t: string[]) => t[1]);
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignored */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 6000);
            } catch {
                checkRemaining();
            }
        }
    });
}
