// Lightweight content script that listens for connection requests from web pages
// This runs on all pages but does minimal work until a connect request is received

let isInjected = false;

// Listen for connect requests from the page
window.addEventListener('nostr-wot-connect', async () => {
    if (isInjected) {
        // Already injected, just notify
        window.dispatchEvent(new CustomEvent('nostr-wot-ready'));
        return;
    }

    try {
        // Request background script to inject the full API
        const response = await chrome.runtime.sendMessage({ method: 'injectWotApi' });

        if (response?.result?.ok) {
            isInjected = true;
            // The inject.js will dispatch nostr-wot-ready when loaded
        } else {
            window.dispatchEvent(new CustomEvent('nostr-wot-error', {
                detail: { error: response?.result?.error || 'Injection failed' }
            }));
        }
    } catch (e) {
        window.dispatchEvent(new CustomEvent('nostr-wot-error', {
            detail: { error: e.message }
        }));
    }
});

// Also listen for check requests (to see if extension is installed)
window.addEventListener('nostr-wot-check', () => {
    window.dispatchEvent(new CustomEvent('nostr-wot-present', {
        detail: { injected: isInjected }
    }));
});