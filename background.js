import { RemoteOracle } from './lib/api.js';
import { LocalGraph } from './lib/graph.js';
import { GraphSync, isSyncInProgress, stopSync } from './lib/sync.js';
import { calculateScore, DEFAULT_SCORING } from './lib/scoring.js';
import * as storage from './lib/storage.js';

const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.mappingbitcoin.com'];

let config = {
    mode: 'remote',  // 'remote' | 'local' | 'hybrid'
    oracleUrl: DEFAULT_ORACLE_URL,
    myPubkey: null,
    relays: DEFAULT_RELAYS,
    maxHops: 3,
    timeout: 5000,
    scoring: DEFAULT_SCORING,
};

let oracle = null;
let localGraph = null;

// Load config on startup
loadConfig();

async function loadConfig() {
    const data = await chrome.storage.sync.get([
        'mode', 'oracleUrl', 'myPubkey', 'relays', 'maxHops', 'timeout', 'scoring'
    ]);

    config.mode = data.mode || 'remote';
    config.oracleUrl = data.oracleUrl || DEFAULT_ORACLE_URL;
    config.myPubkey = data.myPubkey || null;
    config.maxHops = data.maxHops || 3;
    config.timeout = data.timeout || 5000;
    config.scoring = data.scoring || DEFAULT_SCORING;

    // Parse relays from comma-separated string
    if (data.relays) {
        config.relays = data.relays.split(',').map(r => r.trim()).filter(Boolean);
    }

    oracle = new RemoteOracle(config.oracleUrl);
    localGraph = new LocalGraph();
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleRequest(request)
        .then(result => sendResponse({ result }))
        .catch(error => sendResponse({ error: error.message }));
    return true; // Async response
});

async function handleRequest({ method, params }) {
    switch (method) {
        case 'getDistance':
            return getDistance(config.myPubkey, params.target);

        case 'isInMyWoT':
            const dist = await getDistance(config.myPubkey, params.target);
            const maxHops = params.maxHops ?? config.maxHops;
            return dist !== null && dist <= maxHops;

        case 'getDistanceBetween':
            return getDistance(params.from, params.to);

        case 'getTrustScore':
            return getTrustScore(config.myPubkey, params.target);

        case 'getDetails':
            return getDetails(config.myPubkey, params.target);

        case 'syncGraph':
            return syncGraph(params?.depth || 2);

        case 'stopSync':
            stopSync();
            return { ok: true };

        case 'getSyncState':
            return {
                inProgress: isSyncInProgress(),
                state: await storage.getMeta('syncState')
            };

        case 'clearGraph':
            return clearGraph();

        case 'getStats':
            return storage.getStats();

        case 'getConfig':
            return {
                maxHops: config.maxHops,
                timeout: config.timeout,
                scoring: config.scoring
            };

        case 'getNostrPubkey':
            return getNostrPubkeyFromActiveTab();

        case 'injectWotApi':
            return injectWotApi();

        case 'configUpdated':
            await loadConfig();
            return { ok: true };

        default:
            throw new Error(`Unknown method: ${method}`);
    }
}

async function getDistance(from, to) {
    if (!from) throw new Error('My pubkey not configured');

    if (config.mode === 'local') {
        await localGraph.ensureReady();
        return localGraph.getDistance(from, to, config.maxHops);
    }

    if (config.mode === 'remote') {
        return oracle.getDistance(from, to);
    }

    // Hybrid: try local first, fall back to remote
    await localGraph.ensureReady();
    const local = await localGraph.getDistance(from, to, config.maxHops);
    if (local !== null) return local;
    return oracle.getDistance(from, to);
}

// Get detailed distance info (with path count)
async function getDetails(from, to) {
    if (!from) throw new Error('My pubkey not configured');

    if (config.mode === 'local') {
        await localGraph.ensureReady();
        const info = await localGraph.getDistanceInfo(from, to, config.maxHops);
        return info ? { hops: info.hops, paths: info.paths } : null;
    }

    if (config.mode === 'remote') {
        const info = await oracle.getDistanceInfo(from, to);
        return info ? { hops: info.hops, paths: info.paths ?? null } : null;
    }

    // Hybrid: try local first, fall back to remote for details
    await localGraph.ensureReady();
    const localInfo = await localGraph.getDistanceInfo(from, to, config.maxHops);
    if (localInfo !== null) {
        return { hops: localInfo.hops, paths: localInfo.paths };
    }
    const info = await oracle.getDistanceInfo(from, to);
    return info ? { hops: info.hops, paths: info.paths ?? null } : null;
}

// Calculate trust score based on distance and scoring config
async function getTrustScore(from, to) {
    if (!from) throw new Error('My pubkey not configured');

    const details = await getDetails(from, to);
    if (!details || details.hops === null) {
        return null; // Not connected
    }

    return calculateScore(details.hops, details.paths, config.scoring);
}

async function syncGraph(depth) {
    if (!config.myPubkey) {
        throw new Error('My pubkey not configured');
    }

    if (config.relays.length === 0) {
        throw new Error('No relays configured');
    }

    const sync = new GraphSync(config.relays);

    // Set up progress callback to broadcast updates
    sync.onProgress = (progress) => {
        // Broadcast progress to popup
        chrome.runtime.sendMessage({
            type: 'syncProgress',
            progress
        }).catch(() => {
            // Ignore errors if popup is closed
        });
    };

    return await sync.syncFromPubkey(config.myPubkey, depth);
}

async function clearGraph() {
    await storage.clearAll();
    return { ok: true };
}

// Get pubkey from window.nostr on the active tab
async function getNostrPubkeyFromActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;

        // Use scripting API to inject and execute in page context
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN', // Execute in page context to access window.nostr
            func: async () => {
                try {
                    if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
                        return await window.nostr.getPublicKey();
                    }
                } catch (e) {
                    return null;
                }
                return null;
            }
        });

        return results?.[0]?.result || null;
    } catch (e) {
        // Permission denied or scripting not available on this tab
        return null;
    }
}

// Inject window.nostr.wot API into the active tab
async function injectWotApi() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'No active tab' };

        // Skip chrome:// and other restricted URLs
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
            return { ok: false, error: 'Cannot inject on this page' };
        }

        // Inject content script (handles messaging bridge)
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        // Inject page script (exposes window.nostr.wot)
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            files: ['inject.js']
        });

        return { ok: true, url: tab.url };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
