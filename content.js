// Allowed methods that can be called from page context
const ALLOWED_METHODS = [
    'getDistance', 'isInMyWoT', 'getDistanceBetween', 'getTrustScore', 'getDetails', 'getConfig',
    'getMyPubkey', 'isConfigured', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
    'getFollows', 'getCommonFollows', 'getPath', 'getStats'
];

// Rate limiting: 1000 requests per second
const RATE_LIMIT = 1000;
let requestCount = 0;
let rateLimitReset = Date.now();

function checkRateLimit() {
    const now = Date.now();
    if (now - rateLimitReset >= 1000) {
        requestCount = 0;
        rateLimitReset = now;
    }
    return ++requestCount <= RATE_LIMIT;
}

// Bridge between page and extension
window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'WOT_REQUEST') return;

    const { id, method, params } = event.data;

    // Rate limit check
    if (!checkRateLimit()) {
        window.postMessage({
            type: 'WOT_RESPONSE',
            id,
            result: null,
            error: 'Rate limit exceeded'
        }, window.location.origin);
        return;
    }

    // Only allow whitelisted methods
    if (!ALLOWED_METHODS.includes(method)) {
        window.postMessage({
            type: 'WOT_RESPONSE',
            id,
            result: null,
            error: 'Method not allowed'
        }, window.location.origin);
        return;
    }

    const response = await chrome.runtime.sendMessage({ method, params });

    window.postMessage({
        type: 'WOT_RESPONSE',
        id,
        result: response.result,
        error: response.error
    }, window.location.origin);
});

// Listen for messages from extension (popup/background)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.method === 'getNostrPubkey') {
        // Set up one-time listener for the response from inject.js
        const handler = (event) => {
            if (event.data?.type === 'WOT_NOSTR_PUBKEY_RESULT') {
                window.removeEventListener('message', handler);
                sendResponse({ pubkey: event.data.pubkey, error: event.data.error });
            }
        };
        window.addEventListener('message', handler);

        // Request pubkey from inject.js (page context)
        window.postMessage({ type: 'WOT_GET_NOSTR_PUBKEY' }, window.location.origin);

        // Timeout after 3 seconds
        setTimeout(() => {
            window.removeEventListener('message', handler);
            sendResponse({ pubkey: null, error: 'timeout' });
        }, 3000);

        return true; // Async response
    }
});
