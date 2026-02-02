(() => {
    let requestId = 0;
    const pending = new Map();

    window.addEventListener('message', (event) => {
        if (event.data?.type !== 'WOT_RESPONSE') return;
        const { id, result, error } = event.data;
        const { resolve, reject } = pending.get(id) || {};
        pending.delete(id);
        if (error) reject(new Error(error));
        else resolve(result);
    });

    function call(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++requestId;
            pending.set(id, { resolve, reject });
            window.postMessage({ type: 'WOT_REQUEST', id, method, params }, '*');
        });
    }

    // Expose API
    window.nostr = window.nostr || {};
    window.nostr.wot = {
        getDistance: (target) => call('getDistance', { target }),
        isInMyWoT: (target, maxHops = 3) => call('isInMyWoT', { target, maxHops }),
        getDistanceBetween: (from, to) => call('getDistanceBetween', { from, to }),
    };
})();
