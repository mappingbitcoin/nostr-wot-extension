// Inject into page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = () => script.remove();
document.documentElement.appendChild(script);

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
