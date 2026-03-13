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
import { BG_RATE_LIMIT_PER_SECOND, PROFILE_CACHE_TTL_MS } from '../constants.ts';

// ── Constants ──

export const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com'];

// ── Config ──

export type WotMode = 'local' | 'remote' | 'hybrid';

export interface ExtConfig {
    mode: WotMode;
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

// ── Shared types ──

/** Account entry shape stored in browser.storage.local.accounts */
export interface LocalAccountEntry {
    id: string;
    name: string;
    pubkey: string;
    type: string;
    readOnly: boolean;
}

// ── Oracle & Graph ──

export let oracle: RemoteOracle | null = null;
export let localGraph: LocalGraph | null = null;

export function setOracle(o: RemoteOracle | null): void { oracle = o; }
/** Reset local graph to a fresh instance (used after account/DB changes). */
export function resetLocalGraph(): void { localGraph = new LocalGraph(); }

// ── Profile Cache ──

export const PROFILE_CACHE_TTL = PROFILE_CACHE_TTL_MS;
export interface ProfileCacheEntry { metadata: Record<string, unknown>; fetchedAt: number; }
export const profileCache = new Map<string, ProfileCacheEntry>();

// ── Rate Limiting ──

const RATE_LIMIT_PER_SECOND = BG_RATE_LIMIT_PER_SECOND;
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

/**
 * Build the set of privileged methods from handler maps.
 * This is called once at startup by background.ts — any method registered in a handler map
 * is automatically privileged (restricted to internal extension pages only).
 *
 * Methods NOT in handler maps (e.g. WoT API queries from content scripts) are unprivileged.
 */
export function buildPrivilegedMethods(...handlerMaps: Map<string, HandlerFn>[]): Set<string> {
    const methods = new Set<string>();
    for (const map of handlerMaps) {
        for (const key of map.keys()) {
            methods.add(key);
        }
    }
    return methods;
}

/** Populated at startup by background.ts via buildPrivilegedMethods() */
export let PRIVILEGED_METHODS = new Set<string>();

export function setPrivilegedMethods(methods: Set<string>): void {
    PRIVILEGED_METHODS = methods;
}

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
