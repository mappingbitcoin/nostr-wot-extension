// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.sync.get([
        'mode',
        'oracleUrl',
        'myPubkey',
        'relays',
        'syncDepth'
    ]);

    // Set mode radio button
    const mode = data.mode || 'remote';
    const modeRadio = document.getElementById(`mode-${mode}`);
    if (modeRadio) modeRadio.checked = true;

    document.getElementById('oracleUrl').value = data.oracleUrl || 'https://wot-oracle.mappingbitcoin.com';
    document.getElementById('myPubkey').value = data.myPubkey || '';
    document.getElementById('syncDepth').value = data.syncDepth || '2';

    // Format relays for display (one per line)
    const relays = data.relays || 'wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band';
    document.getElementById('relays').value = relays.split(',').map(r => r.trim()).join('\n');

    updateUI(mode);
    loadStats();
});

// Mode change
document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        updateUI(e.target.value);
    });
});

// Save settings
document.getElementById('save').addEventListener('click', async () => {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'remote';
    const oracleUrl = document.getElementById('oracleUrl').value.trim();
    const myPubkey = document.getElementById('myPubkey').value.trim();
    const syncDepth = document.getElementById('syncDepth').value;

    // Parse relays (support both newline and comma separated)
    const relaysText = document.getElementById('relays').value.trim();
    const relays = relaysText
        .split(/[\n,]+/)
        .map(r => r.trim())
        .filter(Boolean)
        .join(',');

    // Validate pubkey
    if (myPubkey && (myPubkey.length !== 64 || !/^[a-f0-9]+$/i.test(myPubkey))) {
        setStatus('Invalid pubkey format (need 64 hex chars)', 'error');
        return;
    }

    await chrome.storage.sync.set({ mode, oracleUrl, myPubkey, relays, syncDepth });

    // Notify background script
    chrome.runtime.sendMessage({ method: 'configUpdated' });

    setStatus('Settings saved', 'success');
});

// Sync local graph
document.getElementById('sync').addEventListener('click', async () => {
    const myPubkey = document.getElementById('myPubkey').value.trim();
    const depth = parseInt(document.getElementById('syncDepth').value, 10);

    if (!myPubkey) {
        setStatus('Set your pubkey first', 'error');
        return;
    }

    // Save settings first
    document.getElementById('save').click();

    setStatus(`Syncing ${depth} hops...`, 'info');
    document.getElementById('sync').disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            method: 'syncGraph',
            params: { depth }
        });

        if (response.error) {
            setStatus(`Sync failed: ${response.error}`, 'error');
        } else {
            const { nodes, failed } = response.result;
            let msg = `Synced ${nodes} nodes`;
            if (failed > 0) msg += ` (${failed} failed)`;
            setStatus(msg, 'success');
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
    const testResult = document.getElementById('testResult');

    if (!target) {
        showTestResult('Enter a target pubkey', 'error');
        return;
    }

    // Validate target pubkey
    if (target.length !== 64 || !/^[a-f0-9]+$/i.test(target)) {
        showTestResult('Invalid pubkey format (need 64 hex chars)', 'error');
        return;
    }

    try {
        const response = await chrome.runtime.sendMessage({
            method: 'getDistance',
            params: { target }
        });

        if (response.error) {
            showTestResult(`Error: ${response.error}`, 'error');
        } else if (response.result === null) {
            showTestResult('Not connected (no path found)', 'info');
        } else if (response.result === 0) {
            showTestResult('That\'s you!', 'success');
        } else {
            const hops = response.result;
            const label = hops === 1 ? 'hop' : 'hops';
            showTestResult(`Distance: ${hops} ${label}`, 'success');
        }
    } catch (e) {
        showTestResult(`Query failed: ${e.message}`, 'error');
    }
});

// Load local graph stats
async function loadStats() {
    const statsStatus = document.getElementById('statsStatus');
    const statsNodes = document.getElementById('statsNodes');
    const statsEdges = document.getElementById('statsEdges');

    try {
        const response = await chrome.runtime.sendMessage({ method: 'getStats' });
        if (response.result) {
            const { nodes, edges, lastSync } = response.result;

            if (nodes > 0) {
                statsStatus.textContent = lastSync
                    ? `Synced ${formatTimeAgo(lastSync)}`
                    : 'Synced';
                statsStatus.classList.add('synced');
            } else {
                statsStatus.textContent = 'Not synced';
                statsStatus.classList.remove('synced');
            }

            statsNodes.textContent = nodes.toLocaleString();
            statsEdges.textContent = edges.toLocaleString();
        }
    } catch (e) {
        statsStatus.textContent = 'Not synced';
        statsStatus.classList.remove('synced');
        statsNodes.textContent = '-';
        statsEdges.textContent = '-';
    }
}

// Update UI based on mode
function updateUI(mode) {
    const localSection = document.getElementById('localSection');

    if (mode === 'remote') {
        localSection.classList.add('hidden');
    } else {
        localSection.classList.remove('hidden');
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
            status.className = 'status';
        }, 3000);
    }
}

// Show test result
function showTestResult(message, type) {
    const testResult = document.getElementById('testResult');
    testResult.textContent = message;
    testResult.className = `test-result show ${type}`;
}

// Format time ago
function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
