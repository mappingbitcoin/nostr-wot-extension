// Bridge between page and extension
window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'WOT_REQUEST') return;

    const { id, method, params } = event.data;

    const response = await chrome.runtime.sendMessage({ method, params });

    window.postMessage({
        type: 'WOT_RESPONSE',
        id,
        result: response.result,
        error: response.error
    }, '*');
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
        window.postMessage({ type: 'WOT_GET_NOSTR_PUBKEY' }, '*');

        // Timeout after 3 seconds
        setTimeout(() => {
            window.removeEventListener('message', handler);
            sendResponse({ pubkey: null, error: 'timeout' });
        }, 3000);

        return true; // Async response
    }
});
