import { RemoteOracle } from './lib/api.js';
import { LocalGraph } from './lib/graph.js';
import { GraphSync, isSyncInProgress, stopSync } from './lib/sync.js';
import { calculateScore, DEFAULT_SCORING } from './lib/scoring.js';
import * as storage from './lib/storage.js';

const DEFAULT_ORACLE_URL = 'https://wot-oracle.mappingbitcoin.com';
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band', 'wss://relay.mappingbitcoin.com'];

// Rate limiting for API methods (10 requests per second per method)
const RATE_LIMIT_PER_SECOND = 10;
const RATE_LIMIT_WINDOW_MS = 1000;
const rateLimitState = new Map(); // method -> { count, windowStart }

// Methods that should be rate limited (external-facing API methods)
const RATE_LIMITED_METHODS = new Set([
    'getDistance', 'isInMyWoT', 'getDistanceBetween', 'getTrustScore',
    'getDetails', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
    'getFollows', 'getCommonFollows', 'getPath', 'getMyPubkey', 'isConfigured',
    'getConfig', 'getStats'
]);

function checkRateLimit(method) {
    if (!RATE_LIMITED_METHODS.has(method)) {
        return true; // Not rate limited
    }

    const now = Date.now();
    let state = rateLimitState.get(method);

    if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
        // Start a new window
        state = { count: 1, windowStart: now };
        rateLimitState.set(method, state);
        return true;
    }

    if (state.count >= RATE_LIMIT_PER_SECOND) {
        return false; // Rate limit exceeded
    }

    state.count++;
    return true;
}

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
    // Check rate limit for external API methods
    if (!checkRateLimit(method)) {
        throw new Error(`Rate limit exceeded for ${method}. Max ${RATE_LIMIT_PER_SECOND} requests per second.`);
    }

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

        // === New API methods ===

        case 'getMyPubkey':
            return config.myPubkey;

        case 'isConfigured':
            return {
                configured: !!config.myPubkey,
                mode: config.mode,
                hasLocalGraph: (await storage.getStats()).nodes > 0
            };

        case 'getDistanceBatch':
            return getDistanceBatch(params.targets, {
                includePaths: params.includePaths,
                includeScores: params.includeScores
            });

        case 'getTrustScoreBatch':
            return getTrustScoreBatch(params.targets);

        case 'filterByWoT':
            return filterByWoT(params.pubkeys, params.maxHops);

        case 'getFollows':
            return getFollowsForPubkey(params.pubkey);

        case 'getCommonFollows':
            return getCommonFollows(params.pubkey);

        case 'getPath':
            return getPathTo(params.target);

        // === End new API methods ===

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

// Get detailed distance info (with path count and trust score)
async function getDetails(from, to) {
    if (!from) throw new Error('My pubkey not configured');

    let info = null;

    if (config.mode === 'local') {
        await localGraph.ensureReady();
        info = await localGraph.getDistanceInfo(from, to, config.maxHops);
    } else if (config.mode === 'remote') {
        info = await oracle.getDistanceInfo(from, to);
    } else {
        // Hybrid: try local first, fall back to remote for details
        await localGraph.ensureReady();
        info = await localGraph.getDistanceInfo(from, to, config.maxHops);
        if (info === null) {
            info = await oracle.getDistanceInfo(from, to);
        }
    }

    if (!info) return null;

    const hops = info.hops;
    const paths = info.paths ?? null;
    const score = calculateScore(hops, paths, config.scoring);

    return { hops, paths, score };
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

// === New API implementations ===

// Get distances for multiple targets at once
// options: { includePaths?: boolean, includeScores?: boolean }
// Returns:
//   - default: { pubkey: hops }
//   - includePaths: { pubkey: { hops, paths } }
//   - includeScores: { pubkey: { hops, score } }
//   - both: { pubkey: { hops, paths, score } }
async function getDistanceBatch(targets, options = {}) {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    // Support legacy boolean parameter for backwards compatibility
    const opts = typeof options === 'boolean'
        ? { includePaths: options, includeScores: false }
        : { includePaths: false, includeScores: false, ...options };

    const { includePaths, includeScores } = opts;
    const needDetails = includePaths || includeScores;

    if (config.mode === 'local') {
        await localGraph.ensureReady();
        const results = await localGraph.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);
        return formatBatchResults(results, opts);
    }

    if (config.mode === 'remote') {
        if (needDetails) {
            const results = await getDetailsBatchRemote(targets);
            return formatBatchResultsFromDetails(results, opts);
        }
        return oracle.getDistanceBatch(config.myPubkey, targets);
    }

    // Hybrid: try local first, then remote for missing
    await localGraph.ensureReady();
    const localResults = await localGraph.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);

    const obj = {};
    const missing = [];

    for (const [pubkey, info] of localResults) {
        if (info !== null) {
            obj[pubkey] = formatSingleResult(info, opts);
        } else {
            missing.push(pubkey);
        }
    }

    // Fetch missing from remote
    if (missing.length > 0) {
        try {
            if (needDetails) {
                const remoteResults = await getDetailsBatchRemote(missing);
                for (const [pubkey, details] of Object.entries(remoteResults)) {
                    obj[pubkey] = details ? formatSingleResult(details, opts) : null;
                }
            } else {
                const remoteResults = await oracle.getDistanceBatch(config.myPubkey, missing);
                for (const [pubkey, hops] of Object.entries(remoteResults)) {
                    obj[pubkey] = hops;
                }
            }
        } catch {
            for (const pubkey of missing) {
                obj[pubkey] = null;
            }
        }
    }

    return obj;
}

// Format a single result based on options
function formatSingleResult(info, opts) {
    const { includePaths, includeScores } = opts;

    if (!includePaths && !includeScores) {
        return info.hops;
    }

    const result = { hops: info.hops };

    if (includePaths) {
        result.paths = info.paths ?? null;
    }

    if (includeScores) {
        result.score = calculateScore(info.hops, info.paths ?? null, config.scoring);
    }

    return result;
}

// Format batch results from Map
function formatBatchResults(results, opts) {
    const obj = {};
    for (const [pubkey, info] of results) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

// Format batch results from details object
function formatBatchResultsFromDetails(results, opts) {
    const obj = {};
    for (const [pubkey, info] of Object.entries(results)) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

// Helper: fetch details for multiple targets from remote oracle
async function getDetailsBatchRemote(targets) {
    const results = {};
    const CONCURRENCY = 5;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (target) => {
            try {
                const info = await oracle.getDistanceInfo(config.myPubkey, target);
                return [target, info ? { hops: info.hops, paths: info.paths ?? null } : null];
            } catch {
                return [target, null];
            }
        });
        const batchResults = await Promise.all(promises);
        for (const [pubkey, details] of batchResults) {
            results[pubkey] = details;
        }
    }
    return results;
}

// Get trust scores for multiple targets at once
async function getTrustScoreBatch(targets) {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    // Use getDistanceBatch with includeScores to get scores directly
    const results = await getDistanceBatch(targets, { includePaths: true, includeScores: true });
    const scores = {};

    for (const [pubkey, info] of Object.entries(results)) {
        scores[pubkey] = info ? info.score : null;
    }

    return scores;
}

// Filter pubkeys to only those within WoT
async function filterByWoT(pubkeys, maxHops) {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');

    const hops = maxHops ?? config.maxHops;
    const distances = await getDistanceBatch(pubkeys);

    return pubkeys.filter(pubkey => {
        const dist = distances[pubkey];
        return dist !== null && dist <= hops;
    });
}

// Get follows for a specific pubkey
async function getFollowsForPubkey(pubkey) {
    const targetPubkey = pubkey || config.myPubkey;
    if (!targetPubkey) throw new Error('No pubkey specified');

    if (config.mode === 'remote') {
        return oracle.getFollows(targetPubkey);
    }

    if (config.mode === 'hybrid') {
        // Try local first, fall back to remote
        await localGraph.ensureReady();
        const local = await localGraph.getFollows(targetPubkey);
        if (local && local.length > 0) return local;
        return oracle.getFollows(targetPubkey);
    }

    await localGraph.ensureReady();
    return localGraph.getFollows(targetPubkey);
}

// Get common follows between user and target
async function getCommonFollows(targetPubkey) {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!targetPubkey) throw new Error('No target pubkey specified');

    if (config.mode === 'remote') {
        return oracle.getCommonFollows(config.myPubkey, targetPubkey);
    }

    if (config.mode === 'hybrid') {
        // Try local first, fall back to remote
        await localGraph.ensureReady();
        const local = await localGraph.getCommonFollows(config.myPubkey, targetPubkey);
        if (local && local.length > 0) return local;
        return oracle.getCommonFollows(config.myPubkey, targetPubkey);
    }

    await localGraph.ensureReady();
    return localGraph.getCommonFollows(config.myPubkey, targetPubkey);
}

// Get path to a target
async function getPathTo(target) {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!target) throw new Error('No target specified');

    if (config.mode === 'remote') {
        return oracle.getPath(config.myPubkey, target);
    }

    if (config.mode === 'hybrid') {
        // Try local first, fall back to remote
        await localGraph.ensureReady();
        const local = await localGraph.getPath(config.myPubkey, target, config.maxHops);
        if (local) return local;
        return oracle.getPath(config.myPubkey, target);
    }

    await localGraph.ensureReady();
    return localGraph.getPath(config.myPubkey, target, config.maxHops);
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
