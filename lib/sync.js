import * as storage from './storage.js';

const BATCH_SIZE = 50; // Pubkeys per batch
const PROGRESS_INTERVAL = 200; // Min ms between progress updates
const CONNECTION_TIMEOUT = 5000; // Time to wait for relay connection
const REQUEST_TIMEOUT = 10000; // Time to wait for response
const BASE_DELAY = 50; // Base delay between requests per relay (ms)
const MAX_DELAY = 2000; // Max delay when throttled
const CONCURRENT_PER_RELAY = 5; // Max concurrent requests per relay

let syncInProgress = false;
let syncAborted = false;
let currentSyncInstance = null;

export function isSyncInProgress() {
    return syncInProgress;
}

export function stopSync() {
    if (currentSyncInstance) {
        syncAborted = true;
        currentSyncInstance.abort();
    }
}

class RelayConnection {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.ready = false;
        this.pending = new Map(); // subId -> { resolve, follows, createdAt, done }
        this.delay = BASE_DELAY; // Adaptive delay
        this.lastRequest = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.inFlight = 0; // Current requests in flight
    }

    async connect() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.ready = false;
                resolve(false);
            }, CONNECTION_TIMEOUT);

            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.ready = true;
                    resolve(true);
                };

                this.ws.onmessage = (event) => this.handleMessage(event);

                this.ws.onerror = () => {
                    clearTimeout(timeout);
                    this.ready = false;
                    resolve(false);
                };

                this.ws.onclose = () => {
                    this.ready = false;
                    // Resolve any pending requests
                    for (const req of this.pending.values()) {
                        if (!req.done) {
                            req.done = true;
                            req.resolve(null);
                        }
                    }
                    this.pending.clear();
                };
            } catch (e) {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }

    handleMessage(event) {
        try {
            const msg = JSON.parse(event.data);
            const [type, subId, ...rest] = msg;

            if (type === 'EVENT') {
                const nostrEvent = rest[0];
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    // Keep newest event
                    if (!req.createdAt || nostrEvent.created_at > req.createdAt) {
                        req.createdAt = nostrEvent.created_at;
                        req.follows = (nostrEvent.tags || [])
                            .filter(tag => tag[0] === 'p' && tag[1])
                            .map(tag => tag[1]);
                    }
                }
            } else if (type === 'EOSE') {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    this.recordSuccess();
                    try { this.ws.send(JSON.stringify(['CLOSE', subId])); } catch (e) {}
                    req.resolve(req.follows || []);
                    this.pending.delete(subId);
                }
            } else if (type === 'CLOSED' || type === 'NOTICE') {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    // CLOSED/NOTICE might indicate throttling
                    if (type === 'NOTICE') {
                        this.recordError();
                    }
                    req.resolve(req.follows || []);
                    this.pending.delete(subId);
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    recordSuccess() {
        this.successCount++;
        // Gradually decrease delay on success
        if (this.successCount % 10 === 0 && this.delay > BASE_DELAY) {
            this.delay = Math.max(BASE_DELAY, this.delay * 0.8);
        }
    }

    recordError() {
        this.errorCount++;
        // Increase delay on error (backoff)
        this.delay = Math.min(MAX_DELAY, this.delay * 1.5);
    }

    async fetch(pubkey) {
        if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return null;
        }

        // Wait if too many in flight
        while (this.inFlight >= CONCURRENT_PER_RELAY) {
            await new Promise(r => setTimeout(r, 50));
            if (!this.ready) return null;
        }

        // Respect delay between requests
        const now = Date.now();
        const elapsed = now - this.lastRequest;
        if (elapsed < this.delay) {
            await new Promise(r => setTimeout(r, this.delay - elapsed));
        }
        this.lastRequest = Date.now();

        return new Promise((resolve) => {
            const subId = `s${Math.random().toString(36).slice(2, 10)}`;

            const timeout = setTimeout(() => {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    this.recordError();
                    this.pending.delete(subId);
                    resolve(null);
                }
            }, REQUEST_TIMEOUT);

            const req = {
                follows: null,
                createdAt: 0,
                done: false,
                resolve: (follows) => {
                    clearTimeout(timeout);
                    resolve(follows);
                }
            };

            this.pending.set(subId, req);
            this.inFlight++;

            try {
                this.ws.send(JSON.stringify(['REQ', subId, {
                    kinds: [3],
                    authors: [pubkey],
                    limit: 1
                }]));
            } catch (e) {
                clearTimeout(timeout);
                req.done = true;
                this.inFlight--;
                this.pending.delete(subId);
                this.recordError();
                resolve(null);
            }
        });
    }

    close() {
        if (this.ws && this.ws.readyState < 2) {
            try { this.ws.close(); } catch (e) {}
        }
        for (const req of this.pending.values()) {
            if (!req.done) {
                req.done = true;
                req.resolve(null);
            }
        }
        this.pending.clear();
        this.ready = false;
    }
}

export class GraphSync {
    constructor(relays) {
        this.relayUrls = relays;
        this.connections = []; // Array of RelayConnection
        this.onProgress = null;
        this.lastProgressTime = 0;
        this.aborted = false;
    }

    abort() {
        this.aborted = true;
        this.closeConnections();
    }

    async syncFromPubkey(rootPubkey, maxDepth = 2) {
        if (syncInProgress) {
            throw new Error('Sync already in progress');
        }
        syncInProgress = true;
        syncAborted = false;
        this.aborted = false;
        currentSyncInstance = this;

        await storage.setMeta('syncState', {
            inProgress: true,
            startTime: Date.now(),
            rootPubkey,
            maxDepth
        });

        try {
            await this.openConnections();
            return await this._doSync(rootPubkey, maxDepth);
        } finally {
            this.closeConnections();
            syncInProgress = false;
            currentSyncInstance = null;
            await storage.setMeta('syncState', { inProgress: false });
        }
    }

    async openConnections() {
        // Create and connect to all relays
        const connectPromises = this.relayUrls.map(async (url) => {
            const conn = new RelayConnection(url);
            const success = await conn.connect();
            return { conn, success };
        });

        const results = await Promise.all(connectPromises);
        this.connections = results.filter(r => r.success).map(r => r.conn);

        if (this.connections.length === 0) {
            throw new Error('Could not connect to any relay');
        }

        if (this.onProgress) {
            this.onProgress({
                fetched: 0,
                pending: 0,
                currentDepth: 0,
                maxDepth: 0,
                nodesPerDepth: {},
                total: 0,
                connectedRelays: this.connections.length,
                totalRelays: this.relayUrls.length
            });
        }
    }

    closeConnections() {
        for (const conn of this.connections) {
            conn.close();
        }
        this.connections = [];
    }

    // Get best relay for next request (least busy, lowest delay)
    getBestRelay() {
        const ready = this.connections.filter(c => c.ready);
        if (ready.length === 0) return null;

        // Sort by: fewest in-flight, then lowest delay
        ready.sort((a, b) => {
            if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
            return a.delay - b.delay;
        });

        return ready[0];
    }

    async _doSync(rootPubkey, maxDepth) {
        const toFetch = [{ pubkey: rootPubkey, depth: 0 }];
        const fetched = new Set();
        const failed = new Set();
        const queued = new Set([rootPubkey]);
        const nodesPerDepth = {};

        while (toFetch.length > 0) {
            if (this.aborted) {
                return {
                    nodes: fetched.size,
                    fetched: fetched.size,
                    failed: failed.size,
                    nodesPerDepth,
                    aborted: true
                };
            }

            // Get batch of pubkeys
            const batch = [];
            const batchDepths = new Map();

            while (batch.length < BATCH_SIZE && toFetch.length > 0) {
                const item = toFetch.shift();
                if (!fetched.has(item.pubkey) && !failed.has(item.pubkey)) {
                    batch.push(item.pubkey);
                    batchDepths.set(item.pubkey, item.depth);
                }
            }

            if (batch.length === 0) continue;

            // Always fetch from relays - everyone's follows may have changed
            const results = await this.fetchBatch(batch);

            for (const pubkey of batch) {
                const follows = results.get(pubkey);
                const depth = batchDepths.get(pubkey);

                if (follows === null) {
                    failed.add(pubkey);
                    if (depth === maxDepth) {
                        nodesPerDepth[depth] = (nodesPerDepth[depth] || 0) + 1;
                    }
                } else {
                    fetched.add(pubkey);
                    storage.saveFollows(pubkey, follows);
                    nodesPerDepth[depth] = (nodesPerDepth[depth] || 0) + 1;

                    if (depth < maxDepth) {
                        for (const f of follows) {
                            if (!fetched.has(f) && !failed.has(f) && !queued.has(f)) {
                                queued.add(f);
                                toFetch.push({ pubkey: f, depth: depth + 1 });
                            }
                        }
                    }
                }
            }

            // Progress update
            const now = Date.now();
            if (this.onProgress && (now - this.lastProgressTime) >= PROGRESS_INTERVAL) {
                this.lastProgressTime = now;
                const maxDepthSoFar = Math.max(...Object.keys(nodesPerDepth).map(Number), 0);
                this.onProgress({
                    fetched: fetched.size,
                    pending: toFetch.length,
                    currentDepth: maxDepthSoFar,
                    maxDepth,
                    nodesPerDepth: { ...nodesPerDepth },
                    total: fetched.size
                });
            }
        }

        // Final progress
        if (this.onProgress) {
            this.onProgress({
                fetched: fetched.size,
                pending: 0,
                currentDepth: maxDepth,
                maxDepth,
                nodesPerDepth: { ...nodesPerDepth },
                total: fetched.size
            });
        }

        await storage.flushWriteBuffer();
        await storage.setMeta('lastSync', Date.now());
        await storage.setMeta('nodesPerDepth', nodesPerDepth);
        await storage.setMeta('syncDepth', maxDepth);

        return {
            nodes: fetched.size,
            fetched: fetched.size,
            failed: failed.size,
            nodesPerDepth
        };
    }

    // Fetch batch of pubkeys, distributing across relays
    async fetchBatch(pubkeys) {
        const results = new Map();
        for (const pk of pubkeys) {
            results.set(pk, null);
        }

        // Create fetch promises distributed across relays
        const fetchPromises = pubkeys.map(async (pubkey) => {
            // Try relays in order of preference until one succeeds
            const tried = new Set();

            for (let attempt = 0; attempt < this.connections.length; attempt++) {
                if (this.aborted) return;

                const relay = this.getBestRelay();
                if (!relay || tried.has(relay)) {
                    // All relays tried or no relay available
                    break;
                }
                tried.add(relay);

                const follows = await relay.fetch(pubkey);
                if (follows !== null) {
                    results.set(pubkey, follows);
                    return;
                }
            }
        });

        await Promise.all(fetchPromises);
        return results;
    }
}
