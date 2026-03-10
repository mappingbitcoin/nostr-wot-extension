/**
 * Shared state, constants, and utilities for background handler modules.
 * Follows the same pattern as lib/vault.ts (module-level mutable state).
 * @module lib/bg/state
 */

import { RemoteOracle } from '../api.ts';
import { LocalGraph } from '../graph.ts';
import { npubDecode } from '../crypto/bech32.ts';
import { DEFAULT_SCORING } from '../scoring.ts';
import type { ScoringConfig } from '../types.ts';

// ── Constants ──

export const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com'];

// ── Config ──

export interface ExtConfig {
    mode: string;
    oracleUrl: string;
    oracleUrls?: string[];
    myPubkey: string | null;
    relays: string[];
    maxHops: number;
    timeout: number;
    scoring: ScoringConfig;
}

export const config: ExtConfig = {
    mode: 'hybrid',
    oracleUrl: DEFAULT_ORACLE_URL,
    myPubkey: null,
    relays: DEFAULT_RELAYS,
    maxHops: 3,
    timeout: 5000,
    scoring: DEFAULT_SCORING,
};

// ── Oracle & Graph ──

export let oracle: RemoteOracle | null = null;
export let localGraph: LocalGraph | null = null;

export function setOracle(o: RemoteOracle | null): void { oracle = o; }
export function setLocalGraph(g: LocalGraph | null): void { localGraph = g; }

// ── Profile Cache ──

export const PROFILE_CACHE_TTL = 30 * 60 * 1000; // 30 min
export interface ProfileCacheEntry { metadata: Record<string, unknown>; fetchedAt: number; }
export const profileCache = new Map<string, ProfileCacheEntry>();

// ── Rate Limiting ──

const RATE_LIMIT_PER_SECOND = 50;
const RATE_LIMIT_WINDOW_MS = 1000;
interface RateLimitState { count: number; windowStart: number; }
const rateLimitState = new Map<string, RateLimitState>();

export const RATE_LIMITED_METHODS = new Set([
    'getDistance', 'isInMyWoT', 'getTrustScore',
    'getDetails', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
    'getFollows', 'getCommonFollows', 'getPath', 'getStats',
]);

export function checkRateLimit(method: string): boolean {
    if (!RATE_LIMITED_METHODS.has(method)) {
        return true;
    }

    const now = Date.now();
    let state = rateLimitState.get(method);

    if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
        state = { count: 1, windowStart: now };
        rateLimitState.set(method, state);
        return true;
    }

    if (state.count >= RATE_LIMIT_PER_SECOND) {
        return false;
    }

    state.count++;
    return true;
}

// ── Method Sets ──

export const NIP07_SIGNING_METHODS = new Set([
    'nip07_signEvent', 'nip07_nip04Encrypt', 'nip07_nip04Decrypt',
    'nip07_nip44Encrypt', 'nip07_nip44Decrypt'
]);

export const PRIVILEGED_METHODS = new Set([
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
    'signer_getPending', 'signer_resolve', 'signer_resolveBatch', 'signer_cancelNip46',
    'signer_cancelUnlockWaiters', 'signer_cancelUnlockWaiter',
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
    'wallet_getInfo', 'wallet_getBalance', 'wallet_connect', 'wallet_disconnect',
    'wallet_setAutoApproveThreshold', 'wallet_getAutoApproveThreshold',
    'wallet_makeInvoice', 'wallet_getTransactions', 'wallet_payInvoice',
    'wallet_hasConfig', 'wallet_provision', 'wallet_getNwcUri',
    'wallet_claimLightningAddress', 'wallet_getLightningAddress', 'wallet_releaseLightningAddress',
]);

// ── Utilities ──

export function isRestrictedUrl(url: string | undefined): boolean {
    return !url || url.startsWith('chrome://') || url.startsWith('edge://') ||
        url.startsWith('about:') || url.startsWith('chrome-extension://') || url.startsWith('moz-extension://');
}

export function npubToHex(npub: string): string | null {
    try { return npubDecode(npub); } catch { return null; }
}

export function sanitizeCSS(css: string): string {
    if (!css) return css;
    return css
        .replace(/@import\b[^;]*;?/gi, '/* @import removed */')
        .replace(/url\s*\([^)]*\)/gi, '/* url() removed */')
        .replace(/expression\s*\([^)]*\)/gi, '/* expression() removed */');
}

// ── Handler type ──

export type HandlerFn = (params: Record<string, unknown>) => Promise<unknown>;
