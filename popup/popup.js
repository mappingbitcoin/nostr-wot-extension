import { DEFAULT_SCORING } from '../lib/scoring.js';

// Listen for sync progress updates from background
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'syncProgress') {
        updateSyncProgress(message.progress);
    }
});

// Show sync status UI
function showSyncStatus(show = true) {
    const syncStatus = document.getElementById('syncStatus');
    const syncBtn = document.getElementById('sync');

    if (show) {
        syncStatus.classList.remove('hidden');
        syncBtn.disabled = true;
        syncBtn.classList.add('syncing');
    } else {
        syncStatus.classList.add('hidden');
        syncBtn.disabled = false;
        syncBtn.classList.remove('syncing');
        document.querySelector('.stats-box')?.classList.remove('syncing');
    }
}

// Update UI with sync progress
function updateSyncProgress(progress) {
    const statsStatus = document.getElementById('statsStatus');
    const statsNodes = document.getElementById('statsNodes');
    const depthStats = document.getElementById('depthStats');
    const statsBox = document.querySelector('.stats-box');
    const syncStatusText = document.getElementById('syncStatusText');
    const syncProgress = document.getElementById('syncProgress');

    // Show sync status area
    showSyncStatus(true);

    // Add syncing class for visual indicator
    statsBox.classList.add('syncing');

    // Check if this is just the connection status update
    if (progress.connectedRelays !== undefined) {
        syncStatusText.textContent = `Connected to ${progress.connectedRelays}/${progress.totalRelays} relays`;
        syncProgress.textContent = 'Starting sync...';
        return;
    }

    // Update sync status text
    const pendingText = progress.pending > 0 ? ` (${progress.pending.toLocaleString()} pending)` : '';
    syncStatusText.textContent = `Syncing depth ${progress.currentDepth}/${progress.maxDepth}...`;

    // Update progress details
    syncProgress.textContent = `${progress.total.toLocaleString()} nodes synced${pendingText}`;

    // Update stats display
    statsStatus.textContent = `Syncing...`;
    statsStatus.classList.remove('synced');
    statsNodes.textContent = progress.total.toLocaleString();

    // Update nodes per depth
    if (progress.nodesPerDepth && Object.keys(progress.nodesPerDepth).length > 0) {
        depthStats.innerHTML = '<div class="depth-header">Nodes per depth</div>';
        depthStats.classList.remove('hidden');

        const depths = Object.keys(progress.nodesPerDepth).map(Number).sort((a, b) => a - b);
        for (const depth of depths) {
            const label = depth === 0 ? 'You' : `Hop ${depth}`;
            const row = document.createElement('div');
            row.className = 'stats-row';
            row.innerHTML = `
                <span class="stats-label">${label}</span>
                <span class="stats-value">${progress.nodesPerDepth[depth].toLocaleString()}</span>
            `;
            depthStats.appendChild(row);
        }
    }
}

// Check if sync is in progress (for when popup opens)
async function checkSyncState() {
    try {
        const response = await chrome.runtime.sendMessage({ method: 'getSyncState' });
        if (response?.result?.inProgress) {
            showSyncStatus(true);
            document.getElementById('syncStatusText').textContent = 'Sync in progress...';
            document.getElementById('syncProgress').textContent = 'Waiting for updates...';
        }
    } catch (e) {
        // Ignore
    }
}

// Stop sync button
document.getElementById('stopSync').addEventListener('click', async () => {
    try {
        await chrome.runtime.sendMessage({ method: 'stopSync' });
        setStatus('Sync stopped', 'info');
        showSyncStatus(false);
        loadStats();
    } catch (e) {
        setStatus('Failed to stop sync', 'error');
    }
});

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    const data = await chrome.storage.sync.get([
        'mode',
        'oracleUrl',
        'myPubkey',
        'relays',
        'syncDepth',
        'maxHops',
        'timeout',
        'scoring'
    ]);

    // Set mode radio button
    const mode = data.mode || 'remote';
    const modeRadio = document.getElementById(`mode-${mode}`);
    if (modeRadio) modeRadio.checked = true;

    document.getElementById('oracleUrl').value = data.oracleUrl || 'https://wot-oracle.mappingbitcoin.com';
    document.getElementById('myPubkey').value = data.myPubkey || '';
    document.getElementById('syncDepth').value = data.syncDepth || '2';
    document.getElementById('maxHops').value = data.maxHops || 3;
    document.getElementById('timeout').value = data.timeout || 5000;

    // Format relays for display (one per line)
    const relays = data.relays || 'wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://relay.mappingbitcoin.com';
    document.getElementById('relays').value = relays.split(',').map(r => r.trim()).join('\n');

    // Load scoring settings
    const scoring = data.scoring || DEFAULT_SCORING;
    loadScoringUI(scoring);

    updateUI(mode);
    loadStats();

    // Check if sync is already in progress
    checkSyncState();

    // Try to detect pubkey from window.nostr if not set
    if (!data.myPubkey) {
        tryDetectNostrPubkey();
    }

    // Inject WoT API into active tab
    injectWotApi();
});

// Inject window.nostr.wot API into the active tab
async function injectWotApi() {
    try {
        const response = await chrome.runtime.sendMessage({ method: 'injectWotApi' });
        if (response?.result?.ok) {
            console.log('WoT API injected into:', response.result.url);
        }
    } catch (e) {
        // Silently fail - not all pages can have scripts injected
    }
}

// Load scoring values into UI
function loadScoringUI(scoring) {
    const weights = scoring.distanceWeights || DEFAULT_SCORING.distanceWeights;
    document.getElementById('weight1').value = weights[1] ?? 1.0;
    document.getElementById('weight2').value = weights[2] ?? 0.5;
    document.getElementById('weight3').value = weights[3] ?? 0.25;
    document.getElementById('weight4').value = weights[4] ?? 0.1;

    // Handle both old (single value) and new (per-level) pathBonus format
    const pathBonus = scoring.pathBonus || DEFAULT_SCORING.pathBonus;
    if (typeof pathBonus === 'object') {
        document.getElementById('pathBonus2').value = pathBonus[2] ?? 0.15;
        document.getElementById('pathBonus3').value = pathBonus[3] ?? 0.1;
        document.getElementById('pathBonus4').value = pathBonus[4] ?? 0.05;
    } else {
        // Legacy single value - distribute across levels
        document.getElementById('pathBonus2').value = pathBonus;
        document.getElementById('pathBonus3').value = pathBonus;
        document.getElementById('pathBonus4').value = pathBonus;
    }

    document.getElementById('maxPathBonus').value = scoring.maxPathBonus ?? 0.5;
}

// Get scoring values from UI
function getScoringFromUI() {
    return {
        distanceWeights: {
            1: parseFloat(document.getElementById('weight1').value) || 1.0,
            2: parseFloat(document.getElementById('weight2').value) || 0.5,
            3: parseFloat(document.getElementById('weight3').value) || 0.25,
            4: parseFloat(document.getElementById('weight4').value) || 0.1
        },
        pathBonus: {
            2: parseFloat(document.getElementById('pathBonus2').value) || 0.15,
            3: parseFloat(document.getElementById('pathBonus3').value) || 0.1,
            4: parseFloat(document.getElementById('pathBonus4').value) || 0.05
        },
        maxPathBonus: parseFloat(document.getElementById('maxPathBonus').value) || 0.5
    };
}

// Try to detect pubkey from window.nostr on the active tab
async function tryDetectNostrPubkey() {
    try {
        const response = await chrome.runtime.sendMessage({ method: 'getNostrPubkey' });
        if (response?.result && typeof response.result === 'string' && response.result.length === 64) {
            document.getElementById('myPubkey').value = response.result;
            setStatus('Detected pubkey from Nostr extension', 'info');
        }
    } catch (e) {
        // Silently fail - user can enter manually
    }
}

// Mode change
document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        updateUI(e.target.value);
    });
});

// Menu toggle
const menuBtn = document.getElementById('menuBtn');
const menuDropdown = document.getElementById('menuDropdown');

menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('hidden');
});

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.classList.add('hidden');
    }
});

// Menu item click - open modal
document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', () => {
        const modalId = item.dataset.modal;
        openModal(modalId);
        menuDropdown.classList.add('hidden');
    });
});

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Close modal on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
        backdrop.closest('.modal').classList.add('hidden');
    });
});

// Close modal on X button click
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        const modalId = btn.dataset.modal;
        closeModal(modalId);
    });
});

// Modal save buttons
document.querySelectorAll('.modal-save').forEach(btn => {
    btn.addEventListener('click', async () => {
        const modalId = btn.dataset.modal;
        const success = await saveSettings();
        if (success !== false) {
            closeModal(modalId);
        }
    });
});

// Save settings function (reusable)
// silent: if true, don't show success message
async function saveSettings(silent = false) {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'remote';
    const oracleUrl = document.getElementById('oracleUrl').value.trim();
    const myPubkey = document.getElementById('myPubkey').value.trim();
    const syncDepth = document.getElementById('syncDepth').value;
    const maxHops = parseInt(document.getElementById('maxHops').value, 10) || 3;
    const timeout = parseInt(document.getElementById('timeout').value, 10) || 5000;
    const scoring = getScoringFromUI();

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
        return false;
    }

    // Check if pubkey changed and there's local data
    const savedData = await chrome.storage.sync.get(['myPubkey']);
    const previousPubkey = savedData.myPubkey || '';

    if (previousPubkey && myPubkey !== previousPubkey) {
        // Check if there's local graph data
        try {
            const statsResponse = await chrome.runtime.sendMessage({ method: 'getStats' });
            const nodes = statsResponse?.result?.nodes || 0;

            if (nodes > 0) {
                const confirmed = confirm(
                    `Changing your pubkey will delete your locally indexed graph data (${nodes.toLocaleString()} nodes).\n\nDo you want to continue?`
                );

                if (!confirmed) {
                    setStatus('Save cancelled', 'info');
                    return false;
                }

                // Clear local graph data
                await chrome.runtime.sendMessage({ method: 'clearGraph' });
            }
        } catch (e) {
            // Ignore errors checking stats
        }
    }

    await chrome.storage.sync.set({ mode, oracleUrl, myPubkey, relays, syncDepth, maxHops, timeout, scoring });

    // Notify background script
    chrome.runtime.sendMessage({ method: 'configUpdated' });

    if (!silent) {
        setStatus('Settings saved', 'success');
    }

    // Reload stats if pubkey changed
    if (myPubkey !== previousPubkey) {
        loadStats();
    }

    return true;
}

// Save button click handler
document.getElementById('save').addEventListener('click', saveSettings);

// Reset scoring to defaults
document.getElementById('resetScoring').addEventListener('click', () => {
    loadScoringUI(DEFAULT_SCORING);
    setStatus('Scoring reset to defaults (save to apply)', 'info');
});

// Sync local graph
document.getElementById('sync').addEventListener('click', async () => {
    const myPubkey = document.getElementById('myPubkey').value.trim();
    const depth = parseInt(document.getElementById('syncDepth').value, 10);

    if (!myPubkey) {
        setStatus('Set your pubkey first', 'error');
        return;
    }

    // Validate pubkey format
    if (myPubkey.length !== 64 || !/^[a-f0-9]+$/i.test(myPubkey)) {
        setStatus('Invalid pubkey format (need 64 hex chars)', 'error');
        return;
    }

    // Auto-save settings first (silently)
    const saved = await saveSettings(true);
    if (!saved) {
        return;
    }

    // Show sync status UI
    showSyncStatus(true);
    document.getElementById('syncStatusText').textContent = 'Connecting to relays...';
    document.getElementById('syncProgress').textContent = '';

    // Show depth stats container with loading state
    const depthStats = document.getElementById('depthStats');
    depthStats.innerHTML = '<div class="depth-loading">Connecting to relays...</div>';
    depthStats.classList.remove('hidden');

    try {
        const response = await chrome.runtime.sendMessage({
            method: 'syncGraph',
            params: { depth }
        });

        // Hide sync status and reset button
        showSyncStatus(false);

        if (response.error) {
            setStatus(`Sync failed: ${response.error}`, 'error');
        } else {
            const { nodes, reused, failed, aborted } = response.result;
            if (aborted) {
                setStatus('Sync stopped', 'info');
            } else {
                let msg = `Synced ${nodes.toLocaleString()} nodes`;
                if (reused > 0) msg += ` (${reused.toLocaleString()} cached)`;
                if (failed > 0) msg += ` (${failed.toLocaleString()} failed)`;
                setStatus(msg, 'success');
            }
            loadStats();
        }
    } catch (e) {
        showSyncStatus(false);
        setStatus(`Sync failed: ${e.message}`, 'error');
    }
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
        showTestResult('Enter a target pubkey', 'error');
        return;
    }

    // Validate target pubkey
    if (target.length !== 64 || !/^[a-f0-9]+$/i.test(target)) {
        showTestResult('Invalid pubkey format (need 64 hex chars)', 'error');
        return;
    }

    try {
        // Get details (hops + paths) and trust score
        const [detailsResponse, scoreResponse] = await Promise.all([
            chrome.runtime.sendMessage({ method: 'getDetails', params: { target } }),
            chrome.runtime.sendMessage({ method: 'getTrustScore', params: { target } })
        ]);

        if (detailsResponse.error) {
            showTestResult(`Error: ${detailsResponse.error}`, 'error');
        } else if (detailsResponse.result === null) {
            showTestResult('Not connected (no path found)', 'info');
        } else if (detailsResponse.result.hops === 0) {
            showTestResult('That\'s you! (score: 1.00)', 'success');
        } else {
            const { hops, paths } = detailsResponse.result;
            const hopLabel = hops === 1 ? 'hop' : 'hops';
            const score = scoreResponse.result;
            const scoreText = score !== null ? `, score: ${score.toFixed(2)}` : '';
            const pathText = paths !== null ? `, ${paths} path${paths === 1 ? '' : 's'}` : '';
            showTestResult(`${hops} ${hopLabel}${pathText}${scoreText}`, 'success');
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
    const statsSize = document.getElementById('statsSize');
    const depthStats = document.getElementById('depthStats');

    try {
        const response = await chrome.runtime.sendMessage({ method: 'getStats' });
        if (response.result) {
            const { nodes, edges, lastSync, nodesPerDepth, dbSizeBytes } = response.result;

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
            statsSize.textContent = formatBytes(dbSizeBytes);

            // Display nodes per depth
            if (nodesPerDepth && Object.keys(nodesPerDepth).length > 0) {
                depthStats.innerHTML = '<div class="depth-header">Nodes per depth</div>';
                depthStats.classList.remove('hidden');

                // Sort depths and display
                const depths = Object.keys(nodesPerDepth).map(Number).sort((a, b) => a - b);
                for (const depth of depths) {
                    const label = depth === 0 ? 'You' : `Hop ${depth}`;
                    const row = document.createElement('div');
                    row.className = 'stats-row';
                    row.innerHTML = `
                        <span class="stats-label">${label}</span>
                        <span class="stats-value">${nodesPerDepth[depth].toLocaleString()}</span>
                    `;
                    depthStats.appendChild(row);
                }
            } else if (nodes > 0) {
                // Has data but no depth breakdown - needs re-sync
                depthStats.innerHTML = '<div class="depth-hint">Re-sync to see depth breakdown</div>';
                depthStats.classList.remove('hidden');
            } else {
                depthStats.classList.add('hidden');
            }
        }
    } catch (e) {
        statsStatus.textContent = 'Not synced';
        statsStatus.classList.remove('synced');
        statsNodes.textContent = '-';
        statsEdges.textContent = '-';
        statsSize.textContent = '-';
        depthStats.classList.add('hidden');
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

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = bytes / Math.pow(k, i);

    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
