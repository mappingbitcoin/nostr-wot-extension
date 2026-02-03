const DB_NAME = 'nostr-wot';
const DB_VERSION = 2;

let db = null;

// In-memory caches
let pubkeyToId = new Map();
let idToPubkey = new Map();
let nextId = 1;

// In-memory graph (adjacency list) - loaded on init for fast traversal
let graphCache = new Map(); // id -> Uint32Array of follow IDs
let graphLoaded = false;

// Write buffer for batching
const writeBuffer = [];
const WRITE_BUFFER_SIZE = 100;
let writeFlushTimer = null;
let writeFlushInProgress = false;

// Pubkey ID write buffer - batch new ID mappings
const pubkeyWriteBuffer = [];
const PUBKEY_BUFFER_SIZE = 500;
let pubkeyFlushTimer = null;
let pubkeyFlushInProgress = false;

export async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            db = request.result;
            await loadPubkeyCache();
            await loadGraphCache();
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            const oldVersion = event.oldVersion;

            if (oldVersion < 2) {
                // Pubkey mapping: { id: number, pubkey: string }
                if (!database.objectStoreNames.contains('pubkeys')) {
                    const pubkeyStore = database.createObjectStore('pubkeys', { keyPath: 'id' });
                    pubkeyStore.createIndex('pubkey', 'pubkey', { unique: true });
                }

                // Follows with numeric IDs: { id: number, follows: ArrayBuffer }
                if (!database.objectStoreNames.contains('follows_v2')) {
                    database.createObjectStore('follows_v2', { keyPath: 'id' });
                }

                if (!database.objectStoreNames.contains('meta')) {
                    database.createObjectStore('meta', { keyPath: 'key' });
                }

                if (database.objectStoreNames.contains('follows')) {
                    database.deleteObjectStore('follows');
                }
            }
        };
    });
}

// Load pubkey mapping into memory
async function loadPubkeyCache() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pubkeys', 'readonly');
        const store = tx.objectStore('pubkeys');
        const request = store.getAll();

        request.onsuccess = () => {
            pubkeyToId.clear();
            idToPubkey.clear();
            nextId = 1;

            for (const record of request.result) {
                pubkeyToId.set(record.pubkey, record.id);
                idToPubkey.set(record.id, record.pubkey);
                if (record.id >= nextId) {
                    nextId = record.id + 1;
                }
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Load entire graph into memory for fast traversal
async function loadGraphCache() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('follows_v2', 'readonly');
        const store = tx.objectStore('follows_v2');
        const request = store.getAll();

        request.onsuccess = () => {
            graphCache.clear();
            for (const record of request.result) {
                // Decode from stored format
                const follows = decodeFollows(record.follows);
                graphCache.set(record.id, follows);
            }
            graphLoaded = true;
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Encode follow IDs for storage (delta encoding + Uint32Array)
function encodeFollows(followIds) {
    if (followIds.length === 0) return new ArrayBuffer(0);

    // Sort for better delta encoding
    const sorted = [...followIds].sort((a, b) => a - b);

    // Delta encode: store first value, then differences
    const deltas = new Uint32Array(sorted.length);
    deltas[0] = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        deltas[i] = sorted[i] - sorted[i - 1];
    }

    return deltas.buffer;
}

// Decode follow IDs from storage
function decodeFollows(buffer) {
    if (!buffer || buffer.byteLength === 0) return new Uint32Array(0);

    const deltas = new Uint32Array(buffer);
    const result = new Uint32Array(deltas.length);

    // Decode deltas back to absolute values
    result[0] = deltas[0];
    for (let i = 1; i < deltas.length; i++) {
        result[i] = result[i - 1] + deltas[i];
    }

    return result;
}

// Get or create numeric ID for a pubkey (non-blocking, batches writes)
export function getOrCreateId(pubkey) {
    if (pubkeyToId.has(pubkey)) {
        return pubkeyToId.get(pubkey);
    }

    const id = nextId++;
    pubkeyToId.set(pubkey, id);
    idToPubkey.set(id, pubkey);

    // Add to write buffer (will be persisted in batch)
    pubkeyWriteBuffer.push({ id, pubkey });
    schedulePubkeyFlush();

    return id;
}

// Schedule pubkey buffer flush
function schedulePubkeyFlush() {
    if (pubkeyFlushTimer || pubkeyFlushInProgress) return;
    if (pubkeyWriteBuffer.length >= PUBKEY_BUFFER_SIZE) {
        flushPubkeyBuffer();
    } else {
        pubkeyFlushTimer = setTimeout(() => {
            pubkeyFlushTimer = null;
            flushPubkeyBuffer();
        }, 50);
    }
}

// Flush pubkey buffer to DB
async function flushPubkeyBuffer() {
    if (pubkeyWriteBuffer.length === 0 || pubkeyFlushInProgress) return;

    pubkeyFlushInProgress = true;
    const toWrite = pubkeyWriteBuffer.splice(0, pubkeyWriteBuffer.length);

    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('pubkeys', 'readwrite');
            const store = tx.objectStore('pubkeys');
            for (const mapping of toWrite) {
                store.put(mapping);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        pubkeyFlushInProgress = false;
        // If more items accumulated during flush, schedule another
        if (pubkeyWriteBuffer.length > 0) {
            schedulePubkeyFlush();
        }
    }
}

// Get ID for pubkey (returns null if not exists)
export function getId(pubkey) {
    return pubkeyToId.get(pubkey) ?? null;
}

// Get pubkey for ID
export function getPubkey(id) {
    return idToPubkey.get(id) ?? null;
}

// Batch get or create IDs - fully sync, just updates memory
export function getOrCreateIds(pubkeys) {
    const ids = new Array(pubkeys.length);

    for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i];
        if (pubkeyToId.has(pubkey)) {
            ids[i] = pubkeyToId.get(pubkey);
        } else {
            const id = nextId++;
            pubkeyToId.set(pubkey, id);
            idToPubkey.set(id, pubkey);
            ids[i] = id;
            pubkeyWriteBuffer.push({ id, pubkey });
        }
    }

    // Schedule flush if buffer is getting full
    if (pubkeyWriteBuffer.length >= PUBKEY_BUFFER_SIZE) {
        flushPubkeyBuffer();
    } else if (pubkeyWriteBuffer.length > 0) {
        schedulePubkeyFlush();
    }

    return ids;
}

// ============ Follows ============

// Save follows - non-blocking, batches writes
export function saveFollows(pubkey, follows) {
    const id = getOrCreateId(pubkey);
    const followIds = getOrCreateIds(follows);

    // Update in-memory cache immediately
    graphCache.set(id, new Uint32Array(followIds));

    // Add to write buffer
    writeBuffer.push({ id, followIds });

    // Flush if buffer is full, otherwise schedule
    if (writeBuffer.length >= WRITE_BUFFER_SIZE) {
        flushWriteBuffer();
    } else {
        scheduleFlush();
    }
}

// Schedule a delayed flush
function scheduleFlush() {
    if (writeFlushTimer || writeFlushInProgress) return;
    writeFlushTimer = setTimeout(() => {
        writeFlushTimer = null;
        flushWriteBuffer();
    }, 100);
}

// Flush all buffers to DB
export async function flushWriteBuffer() {
    // Flush pubkey mappings first
    await flushPubkeyBuffer();

    // Then flush follows
    if (writeBuffer.length === 0 || writeFlushInProgress) return;

    writeFlushInProgress = true;
    const toWrite = writeBuffer.splice(0, writeBuffer.length);

    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('follows_v2', 'readwrite');
            const store = tx.objectStore('follows_v2');

            for (const { id, followIds } of toWrite) {
                store.put({
                    id,
                    follows: encodeFollows(followIds),
                    updated_at: Date.now()
                });
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } finally {
        writeFlushInProgress = false;
        // If more items accumulated during flush, schedule another
        if (writeBuffer.length > 0) {
            scheduleFlush();
        }
    }
}

// Batch save follows - for bulk imports
export function saveFollowsBatch(records) {
    // Convert all pubkeys to IDs (sync)
    const convertedRecords = [];
    for (const { pubkey, follows } of records) {
        const id = getOrCreateId(pubkey);
        const followIds = getOrCreateIds(follows);
        convertedRecords.push({ id, followIds });

        // Update in-memory cache
        graphCache.set(id, new Uint32Array(followIds));
    }

    // Add all to write buffer
    for (const record of convertedRecords) {
        writeBuffer.push(record);
    }

    // Flush if buffer is large
    if (writeBuffer.length >= WRITE_BUFFER_SIZE) {
        return flushWriteBuffer();
    } else {
        scheduleFlush();
        return Promise.resolve();
    }
}

// Get follows as pubkey strings (for external API)
export async function getFollows(pubkey) {
    const id = getId(pubkey);
    if (id === null) return [];

    const followIds = getFollowIdsSync(id);
    return Array.from(followIds).map(fid => getPubkey(fid)).filter(Boolean);
}

// Get follows as numeric IDs - SYNC from memory cache
export function getFollowIdsSync(id) {
    return graphCache.get(id) || new Uint32Array(0);
}

// Async version for backwards compatibility
export async function getFollowIds(id) {
    return getFollowIdsSync(id);
}

// Batch get follows for multiple IDs - returns Map<id, Uint32Array>
export function getFollowIdsBatch(ids) {
    const result = new Map();
    for (const id of ids) {
        result.set(id, graphCache.get(id) || new Uint32Array(0));
    }
    return result;
}

export async function hasFollows(pubkey) {
    const id = getId(pubkey);
    if (id === null) return false;
    return graphCache.has(id);
}

export async function getAllPubkeys() {
    const ids = Array.from(graphCache.keys());
    return ids.map(id => getPubkey(id)).filter(Boolean);
}

// ============ Stats ============

export async function getStats() {
    await initDB();

    // Most stats from memory
    const nodes = graphCache.size;
    let edges = 0;
    for (const follows of graphCache.values()) {
        edges += follows.length;
    }
    const uniquePubkeys = pubkeyToId.size;

    // Meta from DB
    const meta = await getMetaBatch(['lastSync', 'nodesPerDepth', 'syncDepth']);

    // Get database size
    const dbSize = await getDatabaseSize();

    return {
        nodes,
        edges,
        uniquePubkeys,
        lastSync: meta.lastSync || null,
        nodesPerDepth: meta.nodesPerDepth || null,
        syncDepth: meta.syncDepth || null,
        dbSizeBytes: dbSize
    };
}

// Calculate database size from actual stored data
async function getDatabaseSize() {
    await initDB();

    let totalSize = 0;

    // Calculate pubkeys store size
    // Each entry: { id: number (4 bytes), pubkey: string (64 chars = 64 bytes) } + overhead (~20 bytes)
    const pubkeyCount = pubkeyToId.size;
    totalSize += pubkeyCount * (4 + 64 + 20);

    // Calculate follows_v2 store size from actual stored buffers
    try {
        const size = await new Promise((resolve, reject) => {
            const tx = db.transaction('follows_v2', 'readonly');
            const store = tx.objectStore('follows_v2');
            const request = store.getAll();

            request.onsuccess = () => {
                let followsSize = 0;
                for (const record of request.result) {
                    // id (4 bytes) + follows ArrayBuffer + overhead (~20 bytes)
                    const bufferSize = record.follows?.byteLength || 0;
                    followsSize += 4 + bufferSize + 20;
                }
                resolve(followsSize);
            };
            request.onerror = () => reject(request.error);
        });
        totalSize += size;
    } catch (e) {
        // Fallback: estimate from memory cache
        let totalFollows = 0;
        for (const follows of graphCache.values()) {
            totalFollows += follows.length;
        }
        totalSize += graphCache.size * 24 + totalFollows * 4;
    }

    return totalSize;
}

// ============ Meta ============

export async function setMeta(key, value) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        const request = store.put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getMeta(key) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
    });
}

// Batch get meta values
async function getMetaBatch(keys) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const result = {};

        let pending = keys.length;
        if (pending === 0) {
            resolve(result);
            return;
        }

        for (const key of keys) {
            const request = store.get(key);
            request.onsuccess = () => {
                result[key] = request.result?.value;
                if (--pending === 0) resolve(result);
            };
            request.onerror = () => reject(request.error);
        }
    });
}

// ============ Clear ============

export async function clearAll() {
    const database = await initDB();

    // Clear timers and flags
    if (writeFlushTimer) {
        clearTimeout(writeFlushTimer);
        writeFlushTimer = null;
    }
    if (pubkeyFlushTimer) {
        clearTimeout(pubkeyFlushTimer);
        pubkeyFlushTimer = null;
    }
    writeFlushInProgress = false;
    pubkeyFlushInProgress = false;

    // Clear in-memory caches and buffers
    pubkeyToId.clear();
    idToPubkey.clear();
    graphCache.clear();
    nextId = 1;
    writeBuffer.length = 0;
    pubkeyWriteBuffer.length = 0;

    return new Promise((resolve, reject) => {
        const tx = database.transaction(['follows_v2', 'pubkeys', 'meta'], 'readwrite');

        tx.objectStore('follows_v2').clear();
        tx.objectStore('pubkeys').clear();
        tx.objectStore('meta').clear();

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============ Export/Import ============

export async function exportData() {
    await initDB();
    await flushWriteBuffer(); // Ensure all data is persisted

    // Export from memory cache
    const follows = [];
    for (const [id, followIds] of graphCache) {
        const pubkey = getPubkey(id);
        if (pubkey) {
            follows.push({
                pubkey,
                follows: Array.from(followIds).map(fid => getPubkey(fid)).filter(Boolean)
            });
        }
    }

    const meta = await getMetaBatch(['lastSync', 'nodesPerDepth', 'syncDepth', 'lastImport']);

    return {
        follows,
        meta: Object.entries(meta).map(([key, value]) => ({ key, value })),
        exported_at: Date.now(),
        version: 2
    };
}

export async function importData(data) {
    if (!data.follows || !Array.isArray(data.follows)) {
        throw new Error('Invalid import data');
    }

    await clearAll();
    await initDB();

    // Batch import for efficiency
    const batchSize = 100;
    for (let i = 0; i < data.follows.length; i += batchSize) {
        const batch = data.follows.slice(i, i + batchSize);
        await saveFollowsBatch(batch.map(r => ({
            pubkey: r.pubkey,
            follows: r.follows
        })));
    }

    // Import meta
    if (data.meta) {
        for (const record of data.meta) {
            await setMeta(record.key, record.value);
        }
    }

    await setMeta('lastImport', Date.now());
}

// ============ Graph Utilities ============

// Check if graph is loaded in memory
export function isGraphLoaded() {
    return graphLoaded;
}

// Get graph size stats
export function getGraphMemoryStats() {
    let totalFollows = 0;
    for (const follows of graphCache.values()) {
        totalFollows += follows.length;
    }

    // Rough memory estimate
    const pubkeyBytes = pubkeyToId.size * (64 + 4); // pubkey string + id
    const graphBytes = graphCache.size * 4 + totalFollows * 4; // keys + values

    return {
        nodes: graphCache.size,
        edges: totalFollows,
        pubkeys: pubkeyToId.size,
        estimatedMemoryMB: ((pubkeyBytes + graphBytes) / 1024 / 1024).toFixed(2)
    };
}
