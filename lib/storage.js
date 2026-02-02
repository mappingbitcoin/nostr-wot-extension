const DB_NAME = 'nostr-wot';
const DB_VERSION = 1;

let db = null;

export async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Store follows: { pubkey, follows: [], updated_at }
            if (!database.objectStoreNames.contains('follows')) {
                const followsStore = database.createObjectStore('follows', { keyPath: 'pubkey' });
                followsStore.createIndex('updated_at', 'updated_at');
            }

            // Store metadata: { key, value }
            if (!database.objectStoreNames.contains('meta')) {
                database.createObjectStore('meta', { keyPath: 'key' });
            }
        };
    });
}

// ============ Follows ============

export async function saveFollows(pubkey, follows) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('follows', 'readwrite');
        const store = tx.objectStore('follows');

        const record = {
            pubkey,
            follows,
            updated_at: Date.now()
        };

        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function saveFollowsBatch(records) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('follows', 'readwrite');
        const store = tx.objectStore('follows');

        let completed = 0;
        const total = records.length;

        if (total === 0) {
            resolve();
            return;
        }

        for (const { pubkey, follows } of records) {
            const record = {
                pubkey,
                follows,
                updated_at: Date.now()
            };

            const request = store.put(record);
            request.onsuccess = () => {
                completed++;
                if (completed === total) resolve();
            };
            request.onerror = () => reject(request.error);
        }
    });
}

export async function getFollows(pubkey) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('follows', 'readonly');
        const store = tx.objectStore('follows');

        const request = store.get(pubkey);
        request.onsuccess = () => {
            resolve(request.result?.follows || []);
        };
        request.onerror = () => reject(request.error);
    });
}

export async function hasFollows(pubkey) {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('follows', 'readonly');
        const store = tx.objectStore('follows');

        const request = store.getKey(pubkey);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => reject(request.error);
    });
}

export async function getAllPubkeys() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction('follows', 'readonly');
        const store = tx.objectStore('follows');

        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ============ Stats ============

export async function getStats() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(['follows', 'meta'], 'readonly');

        const followsStore = tx.objectStore('follows');
        const metaStore = tx.objectStore('meta');

        let nodes = 0;
        let edges = 0;
        let lastSync = null;

        // Count nodes
        const countRequest = followsStore.count();
        countRequest.onsuccess = () => {
            nodes = countRequest.result;
        };

        // Count edges (sum of all follows arrays)
        const allRequest = followsStore.getAll();
        allRequest.onsuccess = () => {
            edges = allRequest.result.reduce((sum, record) => sum + record.follows.length, 0);
        };

        // Get last sync time
        const metaRequest = metaStore.get('lastSync');
        metaRequest.onsuccess = () => {
            lastSync = metaRequest.result?.value || null;
        };

        tx.oncomplete = () => {
            resolve({ nodes, edges, lastSync });
        };

        tx.onerror = () => reject(tx.error);
    });
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

// ============ Clear ============

export async function clearAll() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(['follows', 'meta'], 'readwrite');

        tx.objectStore('follows').clear();
        tx.objectStore('meta').clear();

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============ Export/Import ============

export async function exportData() {
    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(['follows', 'meta'], 'readonly');

        const followsRequest = tx.objectStore('follows').getAll();
        const metaRequest = tx.objectStore('meta').getAll();

        let follows = [];
        let meta = [];

        followsRequest.onsuccess = () => {
            follows = followsRequest.result;
        };

        metaRequest.onsuccess = () => {
            meta = metaRequest.result;
        };

        tx.oncomplete = () => {
            resolve({ follows, meta, exported_at: Date.now() });
        };

        tx.onerror = () => reject(tx.error);
    });
}

export async function importData(data) {
    if (!data.follows || !Array.isArray(data.follows)) {
        throw new Error('Invalid import data');
    }

    const database = await initDB();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(['follows', 'meta'], 'readwrite');

        const followsStore = tx.objectStore('follows');
        const metaStore = tx.objectStore('meta');

        // Clear existing
        followsStore.clear();
        metaStore.clear();

        // Import follows
        for (const record of data.follows) {
            followsStore.put(record);
        }

        // Import meta
        if (data.meta) {
            for (const record of data.meta) {
                metaStore.put(record);
            }
        }

        // Set import timestamp
        metaStore.put({ key: 'lastImport', value: Date.now() });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
