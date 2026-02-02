// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.sync.get([
        'mode',
        'oracleUrl',
        'myPubkey',
        'relays'
    ]);

    document.getElementById('mode').value = data.mode || 'remote';
    document.getElementById('oracleUrl').value = data.oracleUrl || 'https://wot-oracle.mappingbitcoin.com';
    document.getElementById('myPubkey').value = data.myPubkey || '';
    document.getElementById('relays').value = data.relays || 'wss://relay.damus.io,wss://nos.lol';

    updateUI(data.mode || 'remote');
    loadStats();
});

// Mode change
document.getElementById('mode').addEventListener('change', (e) => {
    updateUI(e.target.value);
});

// Save settings
document.getElementById('save').addEventListener('click', async () => {
    const mode = document.getElementById('mode').value;
    const oracleUrl = document.getElementById('oracleUrl').value.trim();
    const myPubkey = document.getElementById('myPubkey').value.trim();
    const relays = document.getElementById('relays').value.trim();

    // Validate pubkey
    if (myPubkey && (myPubkey.length !== 64 || !/^[a-f0-9]+$/i.test(myPubkey))) {
        setStatus('Invalid pubkey format (need 64 hex chars)', 'error');
        return;
    }

    await chrome.storage.sync.set({ mode, oracleUrl, myPubkey, relays });

    // Notify background script
    chrome.runtime.sendMessage({ method: 'configUpdated' });

    setStatus('Settings saved', 'success');
});

// Sync local graph
document.getElementById('sync').addEventListener('click', async () => {
    const myPubkey = document.getElementById('myPubkey').value.trim();

    if (!myPubkey) {
        setStatus('Set your pubkey first', 'error');
        return;
    }

    setStatus('Syncing...', 'info');
    document.getElementById('sync').disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            method: 'syncGraph',
            params: { depth: 2 }
        });

        if (response.error) {
            setStatus(`Sync failed: ${response.error}`, 'error');
        } else {
            setStatus(`Synced ${response.result.nodes} nodes`, 'success');
            loadStats();
        }
    } catch (e) {
        setStatus(`Sync failed: ${e.message}`, 'error');
    }

    document.getElementById('sync').disabled = false;
});

// Clear local data
document.getElementById('clear').addEventListener('click', async () => {
    if (!confirm('Clear all local graph data?')) return;

    try {
        await chrome.runtime.sendMessage({ method: 'clearGraph' });
        setStatus('Local data cleared', 'success');
        loadStats();
    } catch (e) {
        setStatus(`Clear failed: ${e.message}`, 'error');
    }
});

// Test query
document.getElementById('test').addEventListener('click', async () => {
    const target = document.getElementById('testTarget').value.trim();

    if (!target) {
        setStatus('Enter a target pubkey', 'error');
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            method: 'getDistance',
            params: { target }
        });

        if (response.error) {
            setStatus(`Error: ${response.error}`, 'error');
        } else if (response.result === null) {
            setStatus('Not connected', 'info');
        } else {
            setStatus(`Distance: ${response.result} hops`, 'success');
        }
    } catch (e) {
        setStatus(`Query failed: ${e.message}`, 'error');
    }
});

// Load local graph stats
async function loadStats() {
    try {
        const response = await chrome.runtime.sendMessage({ method: 'getStats' });
        if (response.result) {
            const { nodes, edges, lastSync } = response.result;
            document.getElementById('stats').innerHTML = `
        <strong>Local graph:</strong> ${nodes} nodes, ${edges} edges
        ${lastSync ? `<br>Last sync: ${new Date(lastSync).toLocaleString()}` : ''}
      `;
        }
    } catch (e) {
        document.getElementById('stats').textContent = 'Local graph: not synced';
    }
}

// Update UI based on mode
function updateUI(mode) {
    const oracleSection = document.getElementById('oracleSection');
    const localSection = document.getElementById('localSection');

    if (mode === 'remote') {
        oracleSection.style.display = 'block';
        localSection.style.display = 'none';
    } else if (mode === 'local') {
        oracleSection.style.display = 'none';
        localSection.style.display = 'block';
    } else {
        // hybrid
        oracleSection.style.display = 'block';
        localSection.style.display = 'block';
    }
}

// Set status message
function setStatus(message, type = 'info') {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;

    if (type === 'success') {
        setTimeout(() => {
            status.textContent = '';
        }, 3000);
    }
}
