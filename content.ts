/**
 * content.ts — Message bridge between page context (inject.ts) and background.ts
 *
 * Runs in ISOLATED world. Bridges three message channels:
 *   - WOT_REQUEST/WOT_RESPONSE: Web of Trust API queries
 *   - NIP07_REQUEST/NIP07_RESPONSE: NIP-07 signer requests (prefixed with nip07_ to background)
 *   - WEBLN_REQUEST/WEBLN_RESPONSE: WebLN provider requests (prefixed with webln_ to background)
 *
 * Each channel has its own allowlist of permitted methods for security.
 *
 * @see https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts — Content script isolation
 */

export {}; // make this a module for declare global

declare global {
    interface Window {
        __nostrWotContentInjected?: boolean;
    }
}

// Guard against double injection
if (window.__nostrWotContentInjected) {
    // Already injected, skip
} else {
    window.__nostrWotContentInjected = true;

    // Cross-browser compatibility
    const browser = (globalThis as unknown as Record<string, typeof chrome>).browser ?? chrome;

    const LOCALHOST_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

    // ── WoT methods ──

    const WOT_ALLOWED_METHODS = [
        'getDistance', 'isInMyWoT', 'getTrustScore', 'getDetails', 'getConfig',
        'getStatus', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
        'getFollows', 'getCommonFollows', 'getPath', 'getStats'
    ] as const;

    // ── NIP-07 methods ──

    const NIP07_ALLOWED_METHODS = [
        'getPublicKey', 'signEvent', 'getRelays',
        'nip04Encrypt', 'nip04Decrypt',
        'nip44Encrypt', 'nip44Decrypt'
    ] as const;

    // ── WebLN methods ──

    const WEBLN_ALLOWED_METHODS = [
        'enable', 'getInfo', 'sendPayment', 'makeInvoice', 'getBalance'
    ] as const;

    // Rate limiting for WoT API calls only (NIP-07 is gated by permissions, not rate limits)
    const WOT_RATE_LIMIT = 100;
    let wotRequestCount = 0;
    let wotRateLimitReset = Date.now();

    function checkWotRateLimit(): boolean {
        const now = Date.now();
        if (now - wotRateLimitReset >= 1000) {
            wotRequestCount = 0;
            wotRateLimitReset = now;
        }
        return ++wotRequestCount <= WOT_RATE_LIMIT;
    }

    function forwardViaPort(portName: string, responseType: string, id: string, method: string, params: unknown): void {
        const origin = window.location.hostname;
        try {
            const port = browser.runtime.connect({ name: portName });
            let responded = false;

            const sendResult = (result: unknown, error: unknown) => {
                if (responded) return;
                responded = true;
                window.postMessage({ type: responseType, id, result, error }, window.location.origin);
            };

            port.onMessage.addListener((response: Record<string, unknown>) => {
                sendResult(response.result, response.error);
                try { port.disconnect(); } catch {}
            });

            port.onDisconnect.addListener(() => {
                sendResult(null, 'Extension context invalidated — reload the page');
            });

            port.postMessage({
                method: portName + '_' + method,
                params: { ...(params as Record<string, unknown>), origin }
            });
        } catch {
            window.postMessage({
                type: responseType, id, result: null,
                error: 'Extension context invalidated — reload the page'
            }, window.location.origin);
        }
    }

    // Bridge between page and extension
    window.addEventListener('message', async (event: MessageEvent) => {
        if (event.source !== window) return;

        // ── WoT requests ──
        if (event.data?.type === 'WOT_REQUEST') {
            const { id, method, params } = event.data;

            if (!checkWotRateLimit()) {
                window.postMessage({
                    type: 'WOT_RESPONSE', id, result: null,
                    error: 'Rate limit exceeded'
                }, window.location.origin);
                return;
            }

            if (!(WOT_ALLOWED_METHODS as readonly string[]).includes(method)) {
                window.postMessage({
                    type: 'WOT_RESPONSE', id, result: null,
                    error: 'Method not allowed'
                }, window.location.origin);
                return;
            }

            try {
                const response = await browser.runtime.sendMessage({ method, params });
                window.postMessage({
                    type: 'WOT_RESPONSE', id,
                    result: response.result,
                    error: response.error
                }, window.location.origin);
            } catch {
                window.postMessage({
                    type: 'WOT_RESPONSE', id, result: null,
                    error: 'Extension context invalidated — reload the page'
                }, window.location.origin);
            }
            return;
        }

        // ── NIP-07 requests ──
        if (event.data?.type === 'NIP07_REQUEST') {
            const { id, method, params } = event.data;

            // Reject NIP-07 from insecure HTTP origins (except localhost)
            if (window.location.protocol === 'http:' &&
                !LOCALHOST_HOSTS.includes(window.location.hostname)) {
                window.postMessage({
                    type: 'NIP07_RESPONSE', id, result: null,
                    error: 'NIP-07 requires a secure (HTTPS) connection'
                }, window.location.origin);
                return;
            }

            if (!(NIP07_ALLOWED_METHODS as readonly string[]).includes(method)) {
                window.postMessage({
                    type: 'NIP07_RESPONSE', id, result: null,
                    error: 'Method not allowed'
                }, window.location.origin);
                return;
            }

            forwardViaPort('nip07', 'NIP07_RESPONSE', id, method, params);
            return;
        }

        // ── WebLN requests ──
        if (event.data?.type === 'WEBLN_REQUEST') {
            const { id, method, params } = event.data;

            // Reject WebLN from insecure HTTP origins (except localhost)
            if (window.location.protocol === 'http:' &&
                !LOCALHOST_HOSTS.includes(window.location.hostname)) {
                window.postMessage({
                    type: 'WEBLN_RESPONSE', id, result: null,
                    error: 'WebLN requires a secure (HTTPS) connection'
                }, window.location.origin);
                return;
            }

            if (!(WEBLN_ALLOWED_METHODS as readonly string[]).includes(method)) {
                window.postMessage({
                    type: 'WEBLN_RESPONSE', id, result: null,
                    error: 'Method not allowed'
                }, window.location.origin);
                return;
            }

            forwardViaPort('webln', 'WEBLN_RESPONSE', id, method, params);
            return;
        }
    });

    // Listen for messages from extension (popup/background)
    browser.runtime.onMessage.addListener((request: Record<string, unknown>, _sender: unknown, sendResponse: (response: unknown) => void) => {
        // Forward account change events to page
        if (request.type === 'NOSTR_ACCOUNT_CHANGED') {
            window.postMessage({ type: 'NOSTR_ACCOUNT_CHANGED', pubkey: request.pubkey }, window.location.origin);
            return;
        }

        if (request.method === 'getNostrPubkey') {
            let responded = false;
            const handler = (event: MessageEvent) => {
                if (event.data?.type === 'WOT_NOSTR_PUBKEY_RESULT') {
                    window.removeEventListener('message', handler);
                    if (!responded) {
                        responded = true;
                        sendResponse({ pubkey: event.data.pubkey, error: event.data.error });
                    }
                }
            };
            window.addEventListener('message', handler);
            window.postMessage({ type: 'WOT_GET_NOSTR_PUBKEY' }, window.location.origin);

            setTimeout(() => {
                window.removeEventListener('message', handler);
                if (!responded) {
                    responded = true;
                    sendResponse({ pubkey: null, error: 'timeout' });
                }
            }, 3000);

            return true; // Async response
        }
    });
}
