import * as storage from './storage.js';

export class GraphSync {
    constructor(relays) {
        this.relays = relays;
        this.onProgress = null; // Callback for progress updates
    }

    async syncFromPubkey(rootPubkey, maxDepth = 2) {
        const toFetch = [{ pubkey: rootPubkey, depth: 0 }];
        const fetched = new Set();
        const failed = new Set();

        while (toFetch.length > 0) {
            const { pubkey, depth } = toFetch.shift();
            if (fetched.has(pubkey) || failed.has(pubkey) || depth > maxDepth) continue;

            const follows = await this.fetchKind3(pubkey);

            if (follows === null) {
                failed.add(pubkey);
                continue;
            }

            fetched.add(pubkey);
            await storage.saveFollows(pubkey, follows);

            // Report progress
            if (this.onProgress) {
                this.onProgress({ fetched: fetched.size, pending: toFetch.length, depth });
            }

            if (depth < maxDepth) {
                for (const f of follows) {
                    if (!fetched.has(f) && !failed.has(f)) {
                        toFetch.push({ pubkey: f, depth: depth + 1 });
                    }
                }
            }
        }

        // Update last sync timestamp
        await storage.setMeta('lastSync', Date.now());

        return { nodes: fetched.size, failed: failed.size };
    }

    async fetchKind3(pubkey) {
        // Try each relay until one succeeds
        for (const relay of this.relays) {
            try {
                const follows = await this.fetchFromRelay(relay, pubkey);
                if (follows !== null) {
                    return follows;
                }
            } catch (e) {
                console.warn(`Relay ${relay} failed for ${pubkey}:`, e.message);
                continue;
            }
        }
        return null; // All relays failed
    }

    fetchFromRelay(relayUrl, pubkey) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                ws.close();
                reject(new Error('Timeout'));
            }, 10000); // 10 second timeout

            let ws;
            try {
                ws = new WebSocket(relayUrl);
            } catch (e) {
                clearTimeout(timeout);
                reject(e);
                return;
            }

            const subId = `wot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let follows = null;
            let latestCreatedAt = 0;

            ws.onopen = () => {
                // Subscribe to kind 3 (contact list) events for this pubkey
                // NIP-01: ["REQ", <subscription_id>, <filters>...]
                const filter = {
                    kinds: [3],
                    authors: [pubkey],
                    limit: 10 // Get recent ones, we'll pick the latest
                };
                ws.send(JSON.stringify(['REQ', subId, filter]));
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg[0] === 'EVENT' && msg[1] === subId) {
                        const nostrEvent = msg[2];

                        // Only process if this is newer than what we've seen
                        if (nostrEvent.created_at > latestCreatedAt) {
                            latestCreatedAt = nostrEvent.created_at;

                            // Extract pubkeys from p-tags
                            // Kind 3 events have tags like: ["p", "pubkey", "relay_url", "petname"]
                            follows = (nostrEvent.tags || [])
                                .filter(tag => tag[0] === 'p' && tag[1])
                                .map(tag => tag[1]);
                        }
                    }

                    if (msg[0] === 'EOSE' && msg[1] === subId) {
                        // End of stored events - we're done
                        clearTimeout(timeout);
                        ws.send(JSON.stringify(['CLOSE', subId]));
                        ws.close();
                        resolve(follows || []);
                    }

                    if (msg[0] === 'NOTICE') {
                        console.warn(`Relay notice from ${relayUrl}:`, msg[1]);
                    }

                    if (msg[0] === 'CLOSED' && msg[1] === subId) {
                        // Subscription was closed by relay
                        clearTimeout(timeout);
                        ws.close();
                        resolve(follows || []);
                    }
                } catch (e) {
                    console.error('Error parsing relay message:', e);
                }
            };

            ws.onerror = (error) => {
                clearTimeout(timeout);
                reject(new Error(`WebSocket error: ${error.message || 'Unknown error'}`));
            };

            ws.onclose = () => {
                clearTimeout(timeout);
                // If we got here without resolving, resolve with what we have
                if (follows !== null) {
                    resolve(follows);
                }
            };
        });
    }
}
