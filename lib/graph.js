import * as storage from './storage.js';

export class LocalGraph {
    constructor() {
        this.ready = storage.initDB();
    }

    async ensureReady() {
        await this.ready;
    }

    async getDistance(from, to, maxHops = 6) {
        const result = await this.getDistanceInfo(from, to, maxHops);
        return result ? result.hops : null;
    }

    // Optimized BFS using sync memory lookups
    async getDistanceInfo(from, to, maxHops = 6) {
        await this.ensureReady();

        if (from === to) return { hops: 0, paths: 1 };

        // Convert pubkeys to numeric IDs
        const fromId = storage.getId(from);
        const toId = storage.getId(to);

        if (fromId === null || toId === null) return null;

        // BFS with path counting - all lookups are sync from memory
        const pathCount = new Map();
        pathCount.set(fromId, 1);

        const visited = new Set([fromId]);
        let frontier = [fromId];
        let hops = 0;
        let targetPaths = 0;
        let foundAtHop = null;

        while (frontier.length > 0 && hops < maxHops) {
            hops++;
            const nextFrontier = [];
            const nextPathCount = new Map();

            // Process entire frontier - all sync lookups
            for (const nodeId of frontier) {
                const currentPaths = pathCount.get(nodeId) || 1;
                // SYNC lookup from memory cache
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const followedId = followIds[i];

                    if (followedId === toId) {
                        targetPaths += currentPaths;
                        foundAtHop = hops;
                    } else if (!visited.has(followedId) && foundAtHop === null) {
                        visited.add(followedId);
                        nextFrontier.push(followedId);
                        nextPathCount.set(followedId, (nextPathCount.get(followedId) || 0) + currentPaths);
                    }
                }
            }

            if (foundAtHop !== null) {
                return { hops: foundAtHop, paths: targetPaths };
            }

            frontier = nextFrontier;
            for (const [nodeId, count] of nextPathCount) {
                pathCount.set(nodeId, count);
            }
        }

        return null;
    }

    // Batch distance check for multiple targets
    async getDistancesBatch(from, targets, maxHops = 6) {
        await this.ensureReady();

        const fromId = storage.getId(from);
        if (fromId === null) {
            return new Map(targets.map(t => [t, null]));
        }

        const targetIds = new Map();
        const results = new Map();

        for (const target of targets) {
            if (from === target) {
                results.set(target, { hops: 0, paths: 1 });
            } else {
                const tid = storage.getId(target);
                if (tid !== null) {
                    targetIds.set(tid, target);
                } else {
                    results.set(target, null);
                }
            }
        }

        if (targetIds.size === 0) return results;

        // BFS looking for all targets at once
        const visited = new Set([fromId]);
        let frontier = [fromId];
        let hops = 0;

        while (frontier.length > 0 && hops < maxHops && targetIds.size > 0) {
            hops++;
            const nextFrontier = [];

            for (const nodeId of frontier) {
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const followedId = followIds[i];

                    if (targetIds.has(followedId)) {
                        const target = targetIds.get(followedId);
                        results.set(target, { hops, paths: 1 }); // Simplified paths for batch
                        targetIds.delete(followedId);
                    }

                    if (!visited.has(followedId)) {
                        visited.add(followedId);
                        nextFrontier.push(followedId);
                    }
                }
            }

            frontier = nextFrontier;
        }

        // Mark remaining targets as not found
        for (const [, target] of targetIds) {
            results.set(target, null);
        }

        return results;
    }

    // Check if target is within maxHops (faster than full distance calc)
    async isWithinHops(from, to, maxHops = 3) {
        await this.ensureReady();

        if (from === to) return true;

        const fromId = storage.getId(from);
        const toId = storage.getId(to);

        if (fromId === null || toId === null) return false;

        const visited = new Set([fromId]);
        let frontier = [fromId];
        let hops = 0;

        while (frontier.length > 0 && hops < maxHops) {
            hops++;
            const nextFrontier = [];

            for (const nodeId of frontier) {
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const followedId = followIds[i];

                    if (followedId === toId) return true;

                    if (!visited.has(followedId)) {
                        visited.add(followedId);
                        nextFrontier.push(followedId);
                    }
                }
            }

            frontier = nextFrontier;
        }

        return false;
    }
}
