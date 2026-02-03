(() => {
    let requestId = 0;
    const pending = new Map();
    const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout for pending requests

    window.addEventListener('message', async (event) => {
        if (event.data?.type === 'WOT_RESPONSE') {
            const { id, result, error } = event.data;
            const entry = pending.get(id);
            if (entry) {
                clearTimeout(entry.timeoutId);
                pending.delete(id);
                if (error) entry.reject(new Error(error));
                else entry.resolve(result);
            }
            return;
        }

        // Handle requests from content script to get nostr pubkey
        if (event.data?.type === 'WOT_GET_NOSTR_PUBKEY') {
            let pubkey = null;
            let error = null;
            try {
                if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
                    pubkey = await window.nostr.getPublicKey();
                }
            } catch (e) {
                error = e.message;
            }
            window.postMessage({
                type: 'WOT_NOSTR_PUBKEY_RESULT',
                pubkey,
                error
            }, window.location.origin);
        }
    });

    function call(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++requestId;
            const timeoutId = setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    reject(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
                }
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timeoutId });
            window.postMessage({ type: 'WOT_REQUEST', id, method, params }, window.location.origin);
        });
    }

    // Expose API
    window.nostr = window.nostr || {};
    window.nostr.wot = {
        // Core methods
        getDistance: (target) => call('getDistance', { target }),
        isInMyWoT: (target, maxHops) => call('isInMyWoT', { target, maxHops }),
        getDistanceBetween: (from, to) => call('getDistanceBetween', { from, to }),
        getTrustScore: (target) => call('getTrustScore', { target }),
        getDetails: (target) => call('getDetails', { target }),
        getConfig: () => call('getConfig', {}),

        // Batch operations
        getDistanceBatch: (targets) => call('getDistanceBatch', { targets }),
        getTrustScoreBatch: (targets) => call('getTrustScoreBatch', { targets }),
        filterByWoT: (pubkeys, maxHops) => call('filterByWoT', { pubkeys, maxHops }),

        // User info
        getMyPubkey: () => call('getMyPubkey', {}),
        isConfigured: () => call('isConfigured', {}),

        // Graph queries
        getFollows: (pubkey) => call('getFollows', { pubkey }),
        getCommonFollows: (pubkey) => call('getCommonFollows', { pubkey }),
        getStats: () => call('getStats', {}),

        // Path info
        getPath: (target) => call('getPath', { target }),
    };
})();
