import { RemoteOracle } from './lib/api.js';
import { LocalGraph } from './lib/graph.js';
import { GraphSync } from './lib/sync.js';
import * as storage from './lib/storage.js';

const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];

let config = {
    mode: 'remote',  // 'remote' | 'local' | 'hybrid'
    oracleUrl: DEFAULT_ORACLE_URL,
    myPubkey: null,
    relays: DEFAULT_RELAYS,
};

let oracle = null;
let localGraph = null;

// Load config on startup
loadConfig();

async function loadConfig() {
    const data = await chrome.storage.sync.get(['mode', 'oracleUrl', 'myPubkey', 'relays']);

    config.mode = data.mode || 'remote';
    config.oracleUrl = data.oracleUrl || DEFAULT_ORACLE_URL;
    config.myPubkey = data.myPubkey || null;

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
            return dist !== null && dist <= params.maxHops;

        case 'getDistanceBetween':
            return getDistance(params.from, params.to);

        case 'syncGraph':
            return syncGraph(params?.depth || 2);

        case 'clearGraph':
            return clearGraph();

        case 'getStats':
            return storage.getStats();

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
        return localGraph.getDistance(from, to);
    }

    if (config.mode === 'remote') {
        return oracle.getDistance(from, to);
    }

    // Hybrid: try local first, fall back to remote
    await localGraph.ensureReady();
    const local = await localGraph.getDistance(from, to);
    if (local !== null) return local;
    return oracle.getDistance(from, to);
}

async function syncGraph(depth) {
    if (!config.myPubkey) {
        throw new Error('My pubkey not configured');
    }

    if (config.relays.length === 0) {
        throw new Error('No relays configured');
    }

    const sync = new GraphSync(config.relays);
    const result = await sync.syncFromPubkey(config.myPubkey, depth);

    return result;
}

async function clearGraph() {
    await storage.clearAll();
    return { ok: true };
}
