import type { StorageStats } from './types.ts';

const DB_PREFIX = 'nostr-wot';
const DB_VERSION = 2;

let db: IDBDatabase | null = null;
let currentAccountId: string | null = null;

// In-memory caches
let pubkeyToId: Map<string, number> = new Map();
let idToPubkey: Map<number, string> = new Map();
let nextId: number = 1;

// In-memory graph (adjacency list) - loaded on init for fast traversal
let graphCache: Map<number, Uint32Array> = new Map(); // id -> Uint32Array of follow IDs

// Write buffer for batching
const writeBuffer: Array<{ id: number; followIds: number[] }> = [];
const WRITE_BUFFER_SIZE = 100;
let writeFlushTimer: ReturnType<typeof setTimeout> | null = null;
let writeFlushInProgress: boolean = false;

// Pubkey ID write buffer - batch new ID mappings
const pubkeyWriteBuffer: Array<{ id: number; pubkey: string }> = [];
const PUBKEY_BUFFER_SIZE = 500;
let pubkeyFlushTimer: ReturnType<typeof setTimeout> | null = null;
let pubkeyFlushInProgress: boolean = false;

function getDbName(accountId: string): string {
    if (!accountId) throw new Error('getDbName requires a non-null accountId');
    return `${DB_PREFIX}-${accountId}`;
}

/**
 * Shared schema upgrade handler for all IDBOpenDBRequest.onupgradeneeded callbacks.
 * Creates (or migrates to) the v2 object store layout.
 */
function upgradeDatabase(database: IDBDatabase, oldVersion: number): void {
    if (oldVersion < 2) {
        if (!database.objectStoreNames.contains('pubkeys')) {
            const pubkeyStore = database.createObjectStore('pubkeys', { keyPath: 'id' });
            pubkeyStore.createIndex('pubkey', 'pubkey', { unique: true });
        }
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
}

export async function initDB(accountId?: string): Promise<IDBDatabase> {
    // If called with no accountId, return existing db or reject
    if (accountId === undefined) {
        if (db) return db;
        throw new Error('initDB requires an accountId when no DB is open');
    }

    // Already open for same account
    if (db && currentAccountId === accountId) return db;

    // Close existing connection if switching
    if (db) {
        db.close();
        db = null;
    }
    currentAccountId = accountId;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(getDbName(currentAccountId!), DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            db = request.result;
            await loadPubkeyCache();
            await loadGraphCache();
            resolve(db!);
        };

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            upgradeDatabase((event.target as IDBOpenDBRequest).result, event.oldVersion);
        };
    });
}

// Reset all in-memory caches, timers, flags, and buffers
function resetCaches(): void {
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

    pubkeyToId.clear();
    idToPubkey.clear();
    graphCache.clear();
    writeBuffer.length = 0;
    pubkeyWriteBuffer.length = 0;

    nextId = 1;
}

// Switch to a different account's database
export async function switchDatabase(accountId: string): Promise<IDBDatabase> {
    // Flush pending writes before switching
    await flushWriteBuffer();

    // Reset all caches
    resetCaches();

    // Close existing connection
    if (db) {
        db.close();
        db = null;
    }

    // Set new account and open its database
    currentAccountId = accountId;
    return initDB(accountId);
}

// Load pubkey mapping into memory
async function loadPubkeyCache(): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db!.transaction('pubkeys', 'readonly');
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
async function loadGraphCache(): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db!.transaction('follows_v2', 'readonly');
        const store = tx.objectStore('follows_v2');
        const request = store.getAll();

        request.onsuccess = () => {
            graphCache.clear();
            for (const record of request.result) {
                // Decode from stored format
                const follows = decodeFollows(record.follows);
                graphCache.set(record.id, follows);
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

// Encode follow IDs for storage (delta encoding + Uint32Array)
function encodeFollows(followIds: number[]): ArrayBuffer {
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
function decodeFollows(buffer: ArrayBuffer): Uint32Array {
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
export function getOrCreateId(pubkey: string): number {
    if (pubkeyToId.has(pubkey)) {
        return pubkeyToId.get(pubkey)!;
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
function schedulePubkeyFlush(): void {
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
async function flushPubkeyBuffer(): Promise<void> {
    if (pubkeyWriteBuffer.length === 0 || pubkeyFlushInProgress) return;

    pubkeyFlushInProgress = true;
    const toWrite = pubkeyWriteBuffer.splice(0, pubkeyWriteBuffer.length);

    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction('pubkeys', 'readwrite');
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
export function getId(pubkey: string): number | null {
    return pubkeyToId.get(pubkey) ?? null;
}

// Get pubkey for ID
export function getPubkey(id: number): string | null {
    return idToPubkey.get(id) ?? null;
}

// Get the highest assigned ID (for typed array sizing)
export function getMaxId(): number {
    return nextId - 1;
}

// Batch get or create IDs - fully sync, just updates memory
export function getOrCreateIds(pubkeys: string[]): number[] {
    const ids = new Array<number>(pubkeys.length);

    for (let i = 0; i < pubkeys.length; i++) {
        const pubkey = pubkeys[i];
        if (pubkeyToId.has(pubkey)) {
            ids[i] = pubkeyToId.get(pubkey)!;
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
export function saveFollows(pubkey: string, follows: string[]): void {
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
function scheduleFlush(): void {
    if (writeFlushTimer || writeFlushInProgress) return;
    writeFlushTimer = setTimeout(() => {
        writeFlushTimer = null;
        flushWriteBuffer();
    }, 100);
}

// Flush all buffers to DB
export async function flushWriteBuffer(): Promise<void> {
    // Flush pubkey mappings first
    await flushPubkeyBuffer();

    // Then flush follows
    if (writeBuffer.length === 0 || writeFlushInProgress) return;

    writeFlushInProgress = true;
    const toWrite = writeBuffer.splice(0, writeBuffer.length);

    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db!.transaction('follows_v2', 'readwrite');
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

// Get follows as pubkey strings (for external API)
export async function getFollows(pubkey: string): Promise<string[]> {
    const id = getId(pubkey);
    if (id === null) return [];

    const followIds = getFollowIdsSync(id);
    return Array.from(followIds).map(fid => getPubkey(fid)).filter(Boolean) as string[];
}

// Get follows as numeric IDs - SYNC from memory cache
export function getFollowIdsSync(id: number): Uint32Array {
    return graphCache.get(id) || new Uint32Array(0);
}

// ============ Stats ============

export async function getStats(): Promise<StorageStats> {
    if (!db) return { nodes: 0, edges: 0, uniquePubkeys: 0, lastSync: null, nodesPerDepth: null, syncDepth: null, dbSizeBytes: 0 };

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
        lastSync: (meta.lastSync as number) || null,
        nodesPerDepth: (meta.nodesPerDepth as Record<number, number>) || null,
        syncDepth: (meta.syncDepth as number) || null,
        dbSizeBytes: dbSize
    };
}

// Calculate database size from actual stored data
async function getDatabaseSize(): Promise<number> {
    if (!db) return 0;

    let totalSize = 0;

    // Calculate pubkeys store size
    // Each entry: { id: number (4 bytes), pubkey: string (64 chars = 64 bytes) } + overhead (~20 bytes)
    const pubkeyCount = pubkeyToId.size;
    totalSize += pubkeyCount * (4 + 64 + 20);

    // Calculate follows_v2 store size from actual stored buffers
    try {
        const size = await new Promise<number>((resolve, reject) => {
            const tx = db!.transaction('follows_v2', 'readonly');
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

export async function setMeta(key: string, value: unknown): Promise<void> {
    if (!db) throw new Error('No database open');
    const database = db;

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readwrite');
        const store = tx.objectStore('meta');
        const request = store.put({ key, value });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function getMeta(key: string): Promise<unknown> {
    if (!db) return undefined;
    const database = db;

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result?.value);
        request.onerror = () => reject(request.error);
    });
}

// Batch get meta values
async function getMetaBatch(keys: string[]): Promise<Record<string, unknown>> {
    if (!db) return Object.fromEntries(keys.map(k => [k, undefined]));
    const database = db;

    return new Promise((resolve, reject) => {
        const tx = database.transaction('meta', 'readonly');
        const store = tx.objectStore('meta');
        const result: Record<string, unknown> = {};

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

export async function clearAll(): Promise<void> {
    if (!db) return;
    const database = db;

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

// Delete a specific account's database
export async function deleteDatabase(accountId: string): Promise<void> {
    const dbName = getDbName(accountId);

    // If this is the currently active DB, reset and close first
    if (db && currentAccountId === accountId) {
        resetCaches();
        db.close();
        db = null;
        currentAccountId = null;
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve(); // Resolve anyway -- DB will be deleted when connections close
    });
}

// List all nostr-wot databases
export async function listAllDatabases(): Promise<Array<{ name: string; accountId: string }>> {
    // indexedDB.databases() is Chrome-only; Firefox doesn't support it
    if (typeof indexedDB.databases !== 'function') {
        // Fallback: return current DB if open
        const results: Array<{ name: string; accountId: string }> = [];
        if (currentAccountId) {
            results.push({ name: getDbName(currentAccountId), accountId: currentAccountId });
        }
        return results;
    }

    const databases = await indexedDB.databases();
    const results: Array<{ name: string; accountId: string }> = [];

    for (const d of databases) {
        if (!d.name) continue;
        if (d.name.startsWith(DB_PREFIX + '-')) {
            results.push({
                name: d.name,
                accountId: d.name.slice(DB_PREFIX.length + 1)
            });
        }
        // Legacy unsuffixed DB is ignored -- migration handles cleanup
    }

    return results;
}

interface DatabaseStatsResult {
    nodes: number;
    edges?: number;
    lastSync: number | null;
    nodesPerDepth?: Record<number, number> | null;
    syncDepth?: number | null;
    dbSizeBytes: number;
}

// Get stats for a specific account's database
export async function getDatabaseStats(accountId: string): Promise<DatabaseStatsResult> {
    // If this is the currently open DB, delegate to getStats()
    if (db && currentAccountId === accountId) {
        return getStats();
    }

    // Check if the DB actually exists before opening (opening creates it)
    const dbName = getDbName(accountId);
    if (typeof indexedDB.databases === 'function') {
        const allDbs = await indexedDB.databases();
        if (!allDbs.some(d => d.name === dbName)) {
            return { nodes: 0, lastSync: null, dbSizeBytes: 0 };
        }
    } else {
        // Firefox: can't check without opening, so return empty for non-current DBs
        return { nodes: 0, lastSync: null, dbSizeBytes: 0 };
    }

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            upgradeDatabase((event.target as IDBOpenDBRequest).result, event.oldVersion);
        };

        request.onsuccess = async () => {
            const tempDb = request.result;

            try {
                // Count nodes and edges in follows_v2
                const { nodes, edges, totalSize } = await new Promise<{ nodes: number; edges: number; totalSize: number }>((res, rej) => {
                    const tx = tempDb.transaction('follows_v2', 'readonly');
                    const store = tx.objectStore('follows_v2');
                    const req = store.getAll();
                    req.onsuccess = () => {
                        let n = 0, e = 0, sz = 0;
                        for (const record of req.result) {
                            n++;
                            const bufLen = record.follows?.byteLength || 0;
                            e += bufLen / 4; // each follow is a uint32
                            sz += 4 + bufLen + 20;
                        }
                        res({ nodes: n, edges: e, totalSize: sz });
                    };
                    req.onerror = () => rej(req.error);
                });

                // Get meta values
                const metaKeys = ['lastSync', 'nodesPerDepth', 'syncDepth'];
                const meta = await new Promise<Record<string, unknown>>((res, rej) => {
                    const tx = tempDb.transaction('meta', 'readonly');
                    const store = tx.objectStore('meta');
                    const result: Record<string, unknown> = {};
                    let pending = metaKeys.length;
                    for (const key of metaKeys) {
                        const getReq = store.get(key);
                        getReq.onsuccess = () => {
                            result[key] = getReq.result?.value;
                            if (--pending === 0) res(result);
                        };
                        getReq.onerror = () => rej(getReq.error);
                    }
                });

                // Count pubkeys for size estimate
                const pubkeyCount = await new Promise<number>((res, rej) => {
                    const tx = tempDb.transaction('pubkeys', 'readonly');
                    const countReq = tx.objectStore('pubkeys').count();
                    countReq.onsuccess = () => res(countReq.result);
                    countReq.onerror = () => rej(countReq.error);
                });

                tempDb.close();

                resolve({
                    nodes,
                    edges,
                    lastSync: (meta.lastSync as number) || null,
                    nodesPerDepth: (meta.nodesPerDepth as Record<number, number>) || null,
                    syncDepth: (meta.syncDepth as number) || null,
                    dbSizeBytes: pubkeyCount * (4 + 64 + 20) + totalSize
                });
            } catch (err) {
                tempDb.close();
                reject(err);
            }
        };
    });
}

// Migrate old global DB to a per-account DB
export async function migrateGlobalDatabase(accountId: string): Promise<boolean> {
    // indexedDB.databases() is Chrome-only; skip migration on Firefox
    if (typeof indexedDB.databases !== 'function') return false;

    const allDbs = await indexedDB.databases();
    const hasGlobal = allDbs.some(d => d.name === DB_PREFIX);
    const hasAccount = allDbs.some(d => d.name === getDbName(accountId));

    // Skip if no global DB or account DB already exists
    if (!hasGlobal || hasAccount) return false;

    // Open old DB, export data
    const oldDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_PREFIX, DB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {}; // no-op, should already exist
    });

    // Read all data from old DB
    const exportTx = oldDb.transaction(['pubkeys', 'follows_v2', 'meta'], 'readonly');

    const pubkeys = await new Promise<Array<{ id: number; pubkey: string }>>(r => {
        const req = exportTx.objectStore('pubkeys').getAll();
        req.onsuccess = () => r(req.result);
    });
    const follows = await new Promise<Array<{ id: number; follows: ArrayBuffer }>>(r => {
        const req = exportTx.objectStore('follows_v2').getAll();
        req.onsuccess = () => r(req.result);
    });
    const meta = await new Promise<Array<{ key: string; value: unknown }>>(r => {
        const req = exportTx.objectStore('meta').getAll();
        req.onsuccess = () => r(req.result);
    });
    oldDb.close();

    // Open new per-account DB and import
    await initDB(accountId);
    const newDb = db!;

    const importTx = newDb.transaction(['pubkeys', 'follows_v2', 'meta'], 'readwrite');
    for (const row of pubkeys) importTx.objectStore('pubkeys').put(row);
    for (const row of follows) importTx.objectStore('follows_v2').put(row);
    for (const row of meta) importTx.objectStore('meta').put(row);

    await new Promise<void>((resolve, reject) => {
        importTx.oncomplete = () => resolve();
        importTx.onerror = () => reject(importTx.error);
    });

    // Rebuild caches from new DB
    await loadPubkeyCache();
    await loadGraphCache();

    // Delete old global DB
    await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(DB_PREFIX);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // ignore errors
    });

    return true;
}
