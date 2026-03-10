
import browser from './lib/browser.ts';
import { RemoteOracle } from './lib/api.ts';
import * as storage from './lib/storage.ts';
import * as vault from './lib/vault.ts';
import * as signer from './lib/signer.ts';
import * as signerPermissions from './lib/permissions.ts';
import { randomHex } from './lib/crypto/utils.ts';
import { DEFAULT_SCORING } from './lib/scoring.ts';
import type { ScoringConfig } from './lib/types.ts';

// ── State & handler modules ──

import {
    config, setOracle, resetLocalGraph,
    PRIVILEGED_METHODS, NIP07_SIGNING_METHODS,
    checkRateLimit, npubToHex,
    type HandlerFn,
} from './lib/bg/state.ts';
import { handlers as wotHandlers } from './lib/bg/wot-handlers.ts';
import { handlers as miscHandlers, logActivity } from './lib/bg/misc-handlers.ts';
import {
    handlers as domainHandlers,
    setupTabListeners, isDomainAllowed, isActiveAccountReadOnly,
    refreshBadgesOnAllTabs,
} from './lib/bg/domain-handlers.ts';
import { handlers as vaultHandlers } from './lib/bg/vault-handlers.ts';
import { handlers as walletHandlers } from './lib/bg/wallet-handlers.ts';
import { handlers as nip07Handlers, validateNip07Params } from './lib/bg/nip07-handlers.ts';
import { handlers as onboardingHandlers } from './lib/bg/onboarding-handlers.ts';

// ── Assemble handler map ──

const allHandlers = new Map<string, HandlerFn>();
for (const group of [wotHandlers, miscHandlers, domainHandlers, vaultHandlers, walletHandlers, nip07Handlers, onboardingHandlers]) {
    for (const [method, fn] of group) {
        allHandlers.set(method, fn);
    }
}

// configUpdated stays here because it calls loadConfig which is local
allHandlers.set('configUpdated', async () => {
    await loadConfig();
    refreshBadgesOnAllTabs();
    return { ok: true };
});

// ── Config loading ──

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
    const oracleCsv = (data.oracleUrl as string) || 'https://wot-oracle.mappingbitcoin.com';
    config.oracleUrls = oracleCsv.split(',').map(u => u.trim()).filter(Boolean);
    config.oracleUrl = config.oracleUrls[0] || 'https://wot-oracle.mappingbitcoin.com';

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
            const id = Date.now().toString(36) + randomHex(6);
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

    setOracle(new RemoteOracle(config.oracleUrl));
    resetLocalGraph();

    // Clean up stale sync state from interrupted syncs
    try {
        const syncState = await storage.getMeta('syncState') as Record<string, unknown> | null;
        if (syncState?.inProgress) {
            await storage.setMeta('syncState', { inProgress: false });
        }
    } catch { /* ignored */ }
}

// ── Startup ──

loadConfig();

signer.cleanupStale();

// Permission migrations
(async () => {
    try {
        const data = await browser.storage.local.get('_permMigrationVersion');
        if ((data as Record<string, unknown>)._permMigrationVersion !== 3) {
            await signerPermissions.migrateToPerKind();
            await signerPermissions.migrateToPerAccount();
            await signerPermissions.migrateForwardToAsk();
            await browser.storage.local.set({ _permMigrationVersion: 3 });
        }
    } catch (e: unknown) {
        console.warn('[PERMISSIONS] Migration failed:', (e as Error).message);
    }
})();

// Auto-unlock vault when auto-lock is "Never"
(async () => {
    try {
        const data = await browser.storage.local.get(['autoLockMs', 'activeAccountId']);
        if (((data as Record<string, unknown>).autoLockMs ?? 900000) === 0 && await vault.exists()) {
            const ok = await vault.unlock('');
            if (ok) {
                if ((data as Record<string, unknown>).activeAccountId) {
                    try {
                        await vault.setActiveAccount((data as Record<string, unknown>).activeAccountId as string);
                    } catch {
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

// Tab listeners for auto-injection
setupTabListeners();

// ── Request dispatch ──

async function handleRequest({ method, params }: { method: string; params: Record<string, unknown> }): Promise<unknown> {
    // Check rate limit for external API methods
    if (!checkRateLimit(method)) {
        throw new Error(`Rate limit exceeded for ${method}. Max 50 requests per second.`);
    }

    // NIP-07: validate params and gate behind domain allowlist
    if (method.startsWith('nip07_')) {
        validateNip07Params(method, params);
        const origin = params?.origin as string;
        if (!origin || !(await isDomainAllowed(origin))) {
            logActivity({ domain: origin || 'unknown', method: method.replace('nip07_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
    }

    // Gate WebLN methods (except enable) behind the same domain allowlist
    if (method.startsWith('webln_') && method !== 'webln_enable') {
        const origin = params?.origin as string;
        if (!origin || !(await isDomainAllowed(origin))) {
            logActivity({ domain: origin || 'unknown', method: method.replace('webln_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
    }

    // Read-only account guard
    if (NIP07_SIGNING_METHODS.has(method) && await isActiveAccountReadOnly()) {
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

    const handler = allHandlers.get(method);
    if (!handler) {
        throw new Error(`Unknown method: ${method}`);
    }

    const result = await handler(params);

    // Remap batch result keys from hex back to original npub keys
    if (_batchKeyMap?.size && result && typeof result === 'object' && !Array.isArray(result) &&
        (method === 'getDistanceBatch' || method === 'getTrustScoreBatch')) {
        const remapped: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(result as Record<string, unknown>)) {
            remapped[_batchKeyMap!.get(key) || key] = val;
        }
        return remapped;
    }

    return result;
}

// ── Message listeners ──

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
    return true;
});

// Port-based handler for NIP-07 and WebLN requests from content scripts
browser.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name !== 'nip07' && port.name !== 'webln') return;

    port.onMessage.addListener(async (request: Record<string, unknown>) => {
        const method = request.method as string;

        // Defense-in-depth: derive origin from browser-verified sender info
        if (method?.startsWith('nip07_') || method?.startsWith('webln_')) {
            const originUrl = port.sender?.frameId === 0
                ? port.sender?.tab?.url
                : (port.sender?.url || port.sender?.tab?.url);
            if (!originUrl) {
                try { port.postMessage({ error: 'Cannot determine request origin' }); } catch {}
                return;
            }
            (request.params as Record<string, unknown>).origin = new URL(originUrl).hostname;
        }

        try {
            console.log('[PORT]', port.name, 'request:', method);
            const result = await handleRequest(request as { method: string; params: Record<string, unknown> });
            console.log('[PORT]', port.name, 'success:', method);
            try { port.postMessage({ result }); } catch {}
        } catch (error) {
            console.error('[PORT]', port.name, 'error:', method, (error as Error).message);
            try { port.postMessage({ error: (error as Error).message || 'Unknown error' }); } catch {}
        }
    });
});
