import { DEFAULT_SCORING } from '../lib/scoring.js';

// Cross-browser compatibility
const browser = typeof globalThis.browser !== 'undefined' ? globalThis.browser : chrome;

// Bech32 decoding for npub support
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Decode(str) {
    const lower = str.toLowerCase();
    const sepIndex = lower.lastIndexOf('1');
    if (sepIndex < 1) return null;

    const hrp = lower.slice(0, sepIndex);
    const data = lower.slice(sepIndex + 1);

    const values = [];
    for (const char of data) {
        const idx = BECH32_ALPHABET.indexOf(char);
        if (idx === -1) return null;
        values.push(idx);
    }

    // Remove checksum (last 6 characters)
    const payload = values.slice(0, -6);

    // Convert 5-bit groups to 8-bit bytes
    let bits = 0;
    let acc = 0;
    const bytes = [];
    for (const v of payload) {
        acc = (acc << 5) | v;
        bits += 5;
        while (bits >= 8) {
            bits -= 8;
            bytes.push((acc >> bits) & 0xff);
        }
    }

    return { hrp, bytes };
}

function npubToHex(npub) {
    if (!npub.startsWith('npub1')) return null;
    const decoded = bech32Decode(npub);
    if (!decoded || decoded.hrp !== 'npub' || decoded.bytes.length !== 32) return null;
    return decoded.bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Convert input to hex (accepts hex or npub)
function normalizeToHex(input) {
    if (!input) return null;
    input = input.trim();

    // Already hex
    if (input.length === 64 && /^[a-f0-9]+$/i.test(input)) {
        return input.toLowerCase();
    }

    // npub format
    if (input.startsWith('npub1')) {
        return npubToHex(input);
    }

    return null;
}

// Listen for sync progress updates from background
browser.runtime.onMessage.addListener((message) => {
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
        depthStats.textContent = '';
        const header = document.createElement('div');
        header.className = 'depth-header';
        header.textContent = 'Nodes per depth';
        depthStats.appendChild(header);
        depthStats.classList.remove('hidden');

        const depths = Object.keys(progress.nodesPerDepth).map(Number).sort((a, b) => a - b);
        for (const depth of depths) {
            const label = depth === 0 ? 'You' : `Hop ${depth}`;
            const row = document.createElement('div');
            row.className = 'stats-row';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'stats-label';
            labelSpan.textContent = label;

            const valueSpan = document.createElement('span');
            valueSpan.className = 'stats-value';
            valueSpan.textContent = progress.nodesPerDepth[depth].toLocaleString();

            row.appendChild(labelSpan);
            row.appendChild(valueSpan);
            depthStats.appendChild(row);
        }
    }
}

// Check if sync is in progress (for when popup opens)
async function checkSyncState() {
    try {
        const response = await browser.runtime.sendMessage({ method: 'getSyncState' });
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
        await browser.runtime.sendMessage({ method: 'stopSync' });
        setStatus('Sync stopped', 'info');
        showSyncStatus(false);
        loadStats();
    } catch (e) {
        setStatus('Failed to stop sync', 'error');
    }
});

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
    const data = await browser.storage.sync.get([
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

    // Check and display permission state
    checkPermissionState();
});

// Check and update permission UI
async function checkPermissionState() {
    const permissionCard = document.getElementById('permissionCard');
    const permissionNeeded = document.getElementById('permissionNeeded');
    const permissionDomainEnabled = document.getElementById('permissionDomainEnabled');
    const permissionAllSites = document.getElementById('permissionAllSites');
    const allowedDomainsSection = document.getElementById('allowedDomainsSection');
    const currentDomainName = document.getElementById('currentDomainName');

    try {
        const [hasHost, allowedDomainsResponse, currentTab] = await Promise.all([
            browser.runtime.sendMessage({ method: 'hasHostPermission' }),
            browser.runtime.sendMessage({ method: 'getAllowedDomains' }),
            browser.tabs.query({ active: true, currentWindow: true })
        ]);

        const allowedDomains = allowedDomainsResponse.result || [];
        const currentUrl = currentTab[0]?.url;
        const currentDomain = currentUrl ? getDomainFromUrl(currentUrl) : null;
        const isCurrentDomainAllowed = currentDomain && allowedDomains.includes(currentDomain);

        permissionCard.classList.remove('hidden');

        // Hide all sections first
        permissionNeeded.classList.add('hidden');
        permissionDomainEnabled.classList.add('hidden');
        permissionAllSites.classList.add('hidden');
        allowedDomainsSection.classList.add('hidden');

        if (hasHost.result) {
            // Full host permission granted
            permissionAllSites.classList.remove('hidden');
        } else if (isCurrentDomainAllowed) {
            // Current domain is in allowed list
            permissionDomainEnabled.classList.remove('hidden');
            currentDomainName.textContent = currentDomain;
        } else {
            // No permissions yet for this domain
            permissionNeeded.classList.remove('hidden');
        }

        // Show allowed domains list if there are any
        if (allowedDomains.length > 0 && !hasHost.result) {
            allowedDomainsSection.classList.remove('hidden');
            renderAllowedDomains(allowedDomains);
        }
    } catch (e) {
        // Hide card if there's an error
        permissionCard.classList.add('hidden');
    }
}

// Get domain from URL
function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

// Render allowed domains list
function renderAllowedDomains(domains) {
    const list = document.getElementById('allowedDomainsList');
    list.textContent = '';

    for (const domain of domains) {
        const item = document.createElement('div');
        item.className = 'allowed-domain-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'allowed-domain-name';
        nameSpan.textContent = domain;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'allowed-domain-remove';
        removeBtn.dataset.domain = domain;
        removeBtn.title = 'Remove';

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M18 6L6 18M6 6l12 12');
        svg.appendChild(path);

        removeBtn.appendChild(svg);
        item.appendChild(nameSpan);
        item.appendChild(removeBtn);
        list.appendChild(item);
    }

    // Add click handlers for remove buttons
    list.querySelectorAll('.allowed-domain-remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const domain = btn.dataset.domain;
            try {
                await browser.runtime.sendMessage({ method: 'removeAllowedDomain', params: { domain } });
                setStatus(`Removed ${domain}`, 'info');
                checkPermissionState();
            } catch (e) {
                setStatus('Failed to remove domain', 'error');
            }
        });
    });
}

// Enable for this domain button handler
document.getElementById('enableThisDomain').addEventListener('click', async () => {
    try {
        const response = await browser.runtime.sendMessage({ method: 'enableForCurrentDomain' });
        if (response.result?.ok) {
            setStatus(`Enabled for ${response.result.domain}`, 'success');
            checkPermissionState();
        } else {
            setStatus(response.result?.error || 'Failed to enable', 'error');
        }
    } catch (e) {
        setStatus('Failed to enable for domain', 'error');
    }
});

// Enable for all sites button handlers
document.getElementById('enableAllSites').addEventListener('click', requestAllSitesPermission);
document.getElementById('upgradeToAllSites').addEventListener('click', requestAllSitesPermission);

async function requestAllSitesPermission() {
    try {
        const response = await browser.runtime.sendMessage({ method: 'requestHostPermission' });
        if (response.result) {
            setStatus('Auto-inject enabled for all sites', 'success');
            checkPermissionState();
            injectWotApi();
        } else {
            setStatus('Permission denied', 'error');
        }
    } catch (e) {
        setStatus('Failed to request permission', 'error');
    }
}

// Inject window.nostr.wot API into the active tab
async function injectWotApi() {
    try {
        const response = await browser.runtime.sendMessage({ method: 'injectWotApi' });
        if (response?.result?.ok) {
            console.log('WoT API injected into:', response.result.url);
        }
    } catch (e) {
        // Silently fail - not all pages can have scripts injected
    }
}

// Convert fraction to percentage for display
function toPercent(value, defaultValue) {
    return Math.round((value ?? defaultValue) * 100);
}

// Convert percentage to fraction for storage
function toFraction(value, defaultValue) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed / 100;
}

// Load scoring values into UI (fractions -> percentages)
function loadScoringUI(scoring) {
    const weights = scoring.distanceWeights || DEFAULT_SCORING.distanceWeights;
    // 1 hop is always 100% (1.0), not shown in UI
    document.getElementById('weight2').value = toPercent(weights[2], 0.5);
    document.getElementById('weight3').value = toPercent(weights[3], 0.25);
    document.getElementById('weight4').value = toPercent(weights[4], 0.1);

    // Handle both old (single value) and new (per-level) pathBonus format
    const pathBonus = scoring.pathBonus || DEFAULT_SCORING.pathBonus;
    if (typeof pathBonus === 'object') {
        document.getElementById('pathBonus2').value = toPercent(pathBonus[2], 0.15);
        document.getElementById('pathBonus3').value = toPercent(pathBonus[3], 0.1);
        document.getElementById('pathBonus4').value = toPercent(pathBonus[4], 0.05);
    } else {
        // Legacy single value - distribute across levels
        const pct = toPercent(pathBonus, 0.1);
        document.getElementById('pathBonus2').value = pct;
        document.getElementById('pathBonus3').value = pct;
        document.getElementById('pathBonus4').value = pct;
    }

    document.getElementById('maxPathBonus').value = toPercent(scoring.maxPathBonus, 0.5);
}

// Get scoring values from UI (percentages -> fractions)
function getScoringFromUI() {
    return {
        distanceWeights: {
            1: 1.0, // 1 hop is always 100%
            2: toFraction(document.getElementById('weight2').value, 0.5),
            3: toFraction(document.getElementById('weight3').value, 0.25),
            4: toFraction(document.getElementById('weight4').value, 0.1)
        },
        pathBonus: {
            2: toFraction(document.getElementById('pathBonus2').value, 0.15),
            3: toFraction(document.getElementById('pathBonus3').value, 0.1),
            4: toFraction(document.getElementById('pathBonus4').value, 0.05)
        },
        maxPathBonus: toFraction(document.getElementById('maxPathBonus').value, 0.5)
    };
}

// Try to detect pubkey from window.nostr on the active tab
async function tryDetectNostrPubkey() {
    try {
        const response = await browser.runtime.sendMessage({ method: 'getNostrPubkey' });
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

// URL validation helpers
function isValidHttpsUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function isValidWssUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'wss:';
    } catch {
        return false;
    }
}

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
    const relaysList = relaysText
        .split(/[\n,]+/)
        .map(r => r.trim())
        .filter(Boolean);

    // Validate oracle URL (must be https://)
    if (oracleUrl && !isValidHttpsUrl(oracleUrl)) {
        setStatus('Oracle URL must use https://', 'error');
        return false;
    }

    // Validate relay URLs (must be wss://)
    for (const relay of relaysList) {
        if (!isValidWssUrl(relay)) {
            setStatus(`Invalid relay URL: ${relay} (must use wss://)`, 'error');
            return false;
        }
    }

    const relays = relaysList.join(',');

    // Validate and normalize pubkey (accepts hex or npub)
    let normalizedPubkey = '';
    if (myPubkey) {
        normalizedPubkey = normalizeToHex(myPubkey);
        if (!normalizedPubkey) {
            setStatus('Invalid pubkey format (use hex or npub)', 'error');
            return false;
        }
        // Update the input field to show the normalized hex
        document.getElementById('myPubkey').value = normalizedPubkey;
    }

    // Check if pubkey changed and there's local data
    const savedData = await browser.storage.sync.get(['myPubkey']);
    const previousPubkey = savedData.myPubkey || '';

    if (previousPubkey && normalizedPubkey !== previousPubkey) {
        // Check if there's local graph data
        try {
            const statsResponse = await browser.runtime.sendMessage({ method: 'getStats' });
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
                await browser.runtime.sendMessage({ method: 'clearGraph' });
            }
        } catch (e) {
            // Ignore errors checking stats
        }
    }

    await browser.storage.sync.set({ mode, oracleUrl, myPubkey: normalizedPubkey, relays, syncDepth, maxHops, timeout, scoring });

    // Notify background script
    browser.runtime.sendMessage({ method: 'configUpdated' });

    if (!silent) {
        setStatus('Settings saved', 'success');
    }

    // Reload stats if pubkey changed
    if (normalizedPubkey !== previousPubkey) {
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
    const pubkeyInput = document.getElementById('myPubkey').value.trim();
    const depth = parseInt(document.getElementById('syncDepth').value, 10);

    if (!pubkeyInput) {
        alert('Please set your pubkey first (hex or npub format)');
        return;
    }

    // Validate and normalize pubkey (accepts hex or npub)
    const normalizedPubkey = normalizeToHex(pubkeyInput);
    if (!normalizedPubkey) {
        alert('Invalid pubkey format. Please use hex (64 characters) or npub format.');
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
    depthStats.textContent = '';
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'depth-loading';
    loadingDiv.textContent = 'Connecting to relays...';
    depthStats.appendChild(loadingDiv);
    depthStats.classList.remove('hidden');

    try {
        const response = await browser.runtime.sendMessage({
            method: 'syncGraph',
            params: { depth }
        });

        // Hide sync status and reset button
        showSyncStatus(false);

        if (response.error) {
            setStatus(`Sync failed: ${response.error}`, 'error');
        } else {
            const { nodes, failed, aborted } = response.result;
            if (aborted) {
                setStatus('Sync stopped', 'info');
            } else {
                let msg = `Synced ${nodes.toLocaleString()} nodes`;
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
        await browser.runtime.sendMessage({ method: 'clearGraph' });
        setStatus('Local data cleared', 'success');
        loadStats();
    } catch (e) {
        setStatus(`Clear failed: ${e.message}`, 'error');
    }
});

// Test query
document.getElementById('test').addEventListener('click', async () => {
    const targetInput = document.getElementById('testTarget').value.trim();

    if (!targetInput) {
        showTestResult('Enter a target pubkey', 'error');
        return;
    }

    // Validate and normalize target pubkey (accepts hex or npub)
    const target = normalizeToHex(targetInput);
    if (!target) {
        showTestResult('Invalid pubkey format (use hex or npub)', 'error');
        return;
    }

    try {
        // Get details (hops + paths) and trust score
        const [detailsResponse, scoreResponse] = await Promise.all([
            browser.runtime.sendMessage({ method: 'getDetails', params: { target } }),
            browser.runtime.sendMessage({ method: 'getTrustScore', params: { target } })
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
        const response = await browser.runtime.sendMessage({ method: 'getStats' });
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
                depthStats.textContent = '';
                const header = document.createElement('div');
                header.className = 'depth-header';
                header.textContent = 'Nodes per depth';
                depthStats.appendChild(header);
                depthStats.classList.remove('hidden');

                // Sort depths and display
                const depths = Object.keys(nodesPerDepth).map(Number).sort((a, b) => a - b);
                for (const depth of depths) {
                    const label = depth === 0 ? 'You' : `Hop ${depth}`;
                    const row = document.createElement('div');
                    row.className = 'stats-row';

                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'stats-label';
                    labelSpan.textContent = label;

                    const valueSpan = document.createElement('span');
                    valueSpan.className = 'stats-value';
                    valueSpan.textContent = nodesPerDepth[depth].toLocaleString();

                    row.appendChild(labelSpan);
                    row.appendChild(valueSpan);
                    depthStats.appendChild(row);
                }
            } else if (nodes > 0) {
                // Has data but no depth breakdown - needs re-sync
                depthStats.textContent = '';
                const hint = document.createElement('div');
                hint.className = 'depth-hint';
                hint.textContent = 'Re-sync to see depth breakdown';
                depthStats.appendChild(hint);
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
