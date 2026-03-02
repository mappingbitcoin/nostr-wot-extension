/**
 * inject.ts — Page-context script exposing window.nostr (NIP-07) and window.nostr.wot
 *
 * Runs in MAIN world (page context). Cannot use ES module imports.
 * All NIP-07 methods are thin message-passing wrappers — no crypto happens here.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md — NIP-07: window.nostr capability for web browsers
 */

export {}; // make this a module for declare global

interface PendingEntry {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

interface NostrNip04 {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

interface NostrNip44 {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

interface WotApi {
    getDistance: (target: string) => Promise<unknown>;
    isInMyWoT: (target: string, maxHops?: number) => Promise<unknown>;
    getTrustScore: (target: string) => Promise<unknown>;
    getDetails: (target: string) => Promise<unknown>;
    getConfig: () => Promise<unknown>;
    getDistanceBatch: (targets: string[], options?: boolean | Record<string, unknown>) => Promise<unknown>;
    getTrustScoreBatch: (targets: string[]) => Promise<unknown>;
    filterByWoT: (pubkeys: string[], maxHops?: number) => Promise<unknown>;
    getStatus: () => Promise<unknown>;
    getFollows: (pubkey?: string) => Promise<unknown>;
    getCommonFollows: (pubkey: string) => Promise<unknown>;
    getStats: () => Promise<unknown>;
    getPath: (target: string) => Promise<unknown>;
}

interface NostrProvider {
    wot: WotApi;
    getPublicKey: () => Promise<string>;
    signEvent: (event: Record<string, unknown>) => Promise<unknown>;
    getRelays: () => Promise<Record<string, { read: boolean; write: boolean }>>;
    nip04: NostrNip04;
    nip44: NostrNip44;
}

declare global {
    interface Window {
        __nostrWotInjected?: boolean;
        nostr: NostrProvider;
    }
}

(() => {
    // Guard against double injection
    if (window.__nostrWotInjected) return;
    window.__nostrWotInjected = true;

    // ── WoT API ──

    const wotPending = new Map<string, PendingEntry>();
    const WOT_TIMEOUT_MS = 30000;

    // ── NIP-07 API ──

    const nip07Pending = new Map<string, PendingEntry>();
    const NIP07_TIMEOUT_MS = 120000; // 2 min (user may need time for prompt)

    // Crypto-random request ID generator (prevents response spoofing from page scripts)
    function randomId(): string {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    }

    window.addEventListener('message', async (event: MessageEvent) => {
        if (event.source !== window) return;

        // WoT responses
        if (event.data?.type === 'WOT_RESPONSE') {
            const { id, result, error } = event.data;
            const entry = wotPending.get(id);
            if (entry) {
                clearTimeout(entry.timeoutId);
                wotPending.delete(id);
                if (error) entry.reject(new Error(error));
                else entry.resolve(result);
            }
            return;
        }

        // NIP-07 responses
        if (event.data?.type === 'NIP07_RESPONSE') {
            const { id, result, error } = event.data;
            const entry = nip07Pending.get(id);
            if (entry) {
                clearTimeout(entry.timeoutId);
                nip07Pending.delete(id);
                if (error) entry.reject(new Error(error));
                else entry.resolve(result);
            }
            return;
        }

        // Account changed notification from background
        if (event.data?.type === 'NOSTR_ACCOUNT_CHANGED') {
            window.dispatchEvent(new CustomEvent('nostr:accountChanged', {
                detail: { pubkey: event.data.pubkey }
            }));
            return;
        }

        // Handle requests from content script to get nostr pubkey
        if (event.data?.type === 'WOT_GET_NOSTR_PUBKEY') {
            let pubkey: string | null = null;
            let error: string | null = null;
            try {
                if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
                    pubkey = await window.nostr.getPublicKey();
                }
            } catch (e: unknown) {
                error = (e as Error).message;
            }
            window.postMessage({
                type: 'WOT_NOSTR_PUBKEY_RESULT',
                pubkey,
                error
            }, window.location.origin);
        }
    });

    function wotCall(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = randomId();
            const timeoutId = setTimeout(() => {
                if (wotPending.has(id)) {
                    wotPending.delete(id);
                    reject(new Error(`WoT request timeout after ${WOT_TIMEOUT_MS}ms`));
                }
            }, WOT_TIMEOUT_MS);
            wotPending.set(id, { resolve, reject, timeoutId });
            window.postMessage({ type: 'WOT_REQUEST', id, method, params }, window.location.origin);
        });
    }

    function nip07Call(method: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const id = randomId();
            const timeoutId = setTimeout(() => {
                if (nip07Pending.has(id)) {
                    nip07Pending.delete(id);
                    reject(new Error(`NIP-07 request timeout`));
                }
            }, NIP07_TIMEOUT_MS);
            nip07Pending.set(id, { resolve, reject, timeoutId });
            window.postMessage({ type: 'NIP07_REQUEST', id, method, params }, window.location.origin);
        });
    }

    // ── Expose APIs ──

    window.nostr = window.nostr || {} as NostrProvider;

    // WoT API (always set)
    window.nostr.wot = {
        getDistance: (target) => wotCall('getDistance', { target }),
        isInMyWoT: (target, maxHops) => wotCall('isInMyWoT', { target, maxHops }),
        getTrustScore: (target) => wotCall('getTrustScore', { target }),
        getDetails: (target) => wotCall('getDetails', { target }),
        getConfig: () => wotCall('getConfig', {}),
        getDistanceBatch: (targets, options) => {
            const opts = typeof options === 'boolean'
                ? { includePaths: options }
                : options || {};
            return wotCall('getDistanceBatch', { targets, ...opts });
        },
        getTrustScoreBatch: (targets) => wotCall('getTrustScoreBatch', { targets }),
        filterByWoT: (pubkeys, maxHops) => wotCall('filterByWoT', { pubkeys, maxHops }),
        getStatus: () => wotCall('getStatus', {}),
        getFollows: (pubkey) => wotCall('getFollows', { pubkey }),
        getCommonFollows: (pubkey) => wotCall('getCommonFollows', { pubkey }),
        getStats: () => wotCall('getStats', {}),
        getPath: (target) => wotCall('getPath', { target }),
    };

    // NIP-07 signer methods
    window.nostr.getPublicKey = () => nip07Call('getPublicKey', {}) as Promise<string>;

    window.nostr.signEvent = (event) => nip07Call('signEvent', { event });

    window.nostr.getRelays = () => nip07Call('getRelays', {}) as Promise<Record<string, { read: boolean; write: boolean }>>;

    window.nostr.nip04 = {
        encrypt: (pubkey, plaintext) => nip07Call('nip04Encrypt', { pubkey, plaintext }) as Promise<string>,
        decrypt: (pubkey, ciphertext) => nip07Call('nip04Decrypt', { pubkey, ciphertext }) as Promise<string>
    };

    window.nostr.nip44 = {
        encrypt: (pubkey, plaintext) => nip07Call('nip44Encrypt', { pubkey, plaintext }) as Promise<string>,
        decrypt: (pubkey, ciphertext) => nip07Call('nip44Decrypt', { pubkey, ciphertext }) as Promise<string>
    };

    // Notify page that APIs are ready
    window.dispatchEvent(new CustomEvent('nostr-wot-ready'));
})();
