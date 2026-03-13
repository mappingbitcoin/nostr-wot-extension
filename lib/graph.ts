import * as storage from './storage.ts';
import type { DistanceInfo } from './types.ts';

interface BfsCache {
    rootId: number;
    hops: Uint8Array;
    paths: Uint32Array;
    maxId: number;
}

export class LocalGraph {
    ready: Promise<void>;
    private cache: BfsCache | null;
    private cachedRoot: string | null;

    constructor() {
        this.ready = Promise.resolve();
        this.cache = null;     // { rootId, hops: Uint8Array, paths: Uint32Array, maxId }
        this.cachedRoot = null; // pubkey string of cached root
    }

    async ensureReady(): Promise<void> {
        await this.ready;
    }

    // Invalidate the precomputed cache (called on sync, account switch, clear)
    invalidateCache(): void {
        this.cache = null;
        this.cachedRoot = null;
    }

    // Precompute hops and paths from a root pubkey using a single BFS pass.
    // Results stored in typed arrays indexed by node ID for O(1) lookup.
    private buildCache(rootPubkey: string, maxHops: number = 6): void {
        const rootId = storage.getId(rootPubkey);
        if (rootId === null) {
            this.cache = null;
            this.cachedRoot = null;
            return;
        }

        const maxId = storage.getMaxId();
        // Uint8Array: 0 = unreachable, 1-255 = hop distance. Store hop+1 so 0 means "not reached".
        const hops = new Uint8Array(maxId + 1);
        const paths = new Uint32Array(maxId + 1);

        // Root: distance 0, 1 path
        hops[rootId] = 1; // stored as hop+1
        paths[rootId] = 1;

        let frontier: number[] = [rootId];
        let hop = 0;

        while (frontier.length > 0 && hop < maxHops) {
            hop++;
            const hopStored = hop + 1;
            const nextFrontier: number[] = [];

            for (let f = 0; f < frontier.length; f++) {
                const nodeId = frontier[f];
                const nodePaths = paths[nodeId];
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const fid = followIds[i];
                    if (fid > maxId) continue; // safety guard

                    if (hops[fid] === 0) {
                        // First discovery
                        hops[fid] = hopStored;
                        paths[fid] = nodePaths;
                        nextFrontier.push(fid);
                    } else if (hops[fid] === hopStored) {
                        // Same-level rediscovery -- accumulate paths
                        paths[fid] += nodePaths;
                    }
                    // If hops[fid] < hopStored, it was found at a closer level -- ignore
                }
            }

            frontier = nextFrontier;
        }

        this.cache = { rootId, hops, paths, maxId };
        this.cachedRoot = rootPubkey;
    }

    // Get precomputed result for a (from, to) query. Returns { hops, paths } or null.
    // Only works when from === cachedRoot.
    private getCached(from: string, to: string): DistanceInfo | null | undefined {
        if (!this.cache || this.cachedRoot !== from) return undefined; // cache miss

        if (from === to) return { hops: 0, paths: 1 };

        const toId = storage.getId(to);
        if (toId === null || toId > this.cache.maxId) return null;

        const h = this.cache.hops[toId];
        if (h === 0) return null; // unreachable

        return { hops: h - 1, paths: this.cache.paths[toId] };
    }

    // Ensure cache is built for the given root
    private ensureCache(from: string, maxHops: number): void {
        if (this.cachedRoot !== from || !this.cache) {
            this.buildCache(from, maxHops);
        }
    }

    async getDistance(from: string, to: string, maxHops: number = 6): Promise<number | null> {
        await this.ensureReady();
        this.ensureCache(from, maxHops);

        const cached = this.getCached(from, to);
        if (cached !== undefined) return cached ? cached.hops : null;

        // Fallback BFS for non-cached roots (arbitrary from pubkey)
        const result = this.bfsDistanceInfo(from, to, maxHops);
        return result ? result.hops : null;
    }

    async getDistanceInfo(from: string, to: string, maxHops: number = 6): Promise<DistanceInfo | null> {
        await this.ensureReady();
        this.ensureCache(from, maxHops);

        const cached = this.getCached(from, to);
        if (cached !== undefined) return cached;

        // Fallback BFS for non-cached roots
        return this.bfsDistanceInfo(from, to, maxHops);
    }

    // Raw BFS with path counting -- used for arbitrary (non-root) queries
    private bfsDistanceInfo(from: string, to: string, maxHops: number = 6): DistanceInfo | null {
        if (from === to) return { hops: 0, paths: 1 };

        const fromId = storage.getId(from);
        const toId = storage.getId(to);

        if (fromId === null || toId === null) return null;

        const visited = new Set<number>([fromId]);
        const pathCount = new Map<number, number>([[fromId, 1]]);
        let frontier: number[] = [fromId];
        let hop = 0;
        let targetPaths = 0;
        let foundAtHop: number | null = null;

        while (frontier.length > 0 && hop < maxHops) {
            hop++;
            const nextFrontier: number[] = [];
            const nextPathCount = new Map<number, number>();

            for (const nodeId of frontier) {
                const currentPaths = pathCount.get(nodeId) || 1;
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const fid = followIds[i];

                    if (fid === toId) {
                        targetPaths += currentPaths;
                        foundAtHop = hop;
                    } else if (foundAtHop === null) {
                        if (!visited.has(fid)) {
                            visited.add(fid);
                            nextFrontier.push(fid);
                            nextPathCount.set(fid, (nextPathCount.get(fid) || 0) + currentPaths);
                        } else if (nextPathCount.has(fid)) {
                            nextPathCount.set(fid, nextPathCount.get(fid)! + currentPaths);
                        }
                    }
                }
            }

            if (foundAtHop !== null) {
                return { hops: foundAtHop, paths: targetPaths };
            }

            frontier = nextFrontier;
            for (const [id, count] of nextPathCount) {
                pathCount.set(id, count);
            }
        }

        return null;
    }

    // Batch distance check for multiple targets -- uses cache when available
    async getDistancesBatch(from: string, targets: string[], maxHops: number = 6, includePaths: boolean = false): Promise<Map<string, DistanceInfo | null>> {
        await this.ensureReady();
        this.ensureCache(from, maxHops);

        const results = new Map<string, DistanceInfo | null>();

        // If cache is available for this root, all lookups are O(1)
        if (this.cachedRoot === from && this.cache) {
            for (const target of targets) {
                if (from === target) {
                    results.set(target, { hops: 0, paths: includePaths ? 1 : null });
                    continue;
                }
                const toId = storage.getId(target);
                if (toId === null || toId > this.cache.maxId) {
                    results.set(target, null);
                    continue;
                }
                const h = this.cache.hops[toId];
                if (h === 0) {
                    results.set(target, null);
                } else {
                    results.set(target, {
                        hops: h - 1,
                        paths: includePaths ? this.cache.paths[toId] : null
                    });
                }
            }
            return results;
        }

        // Fallback: full BFS for arbitrary root (same as before)
        return this.bfsBatch(from, targets, maxHops, includePaths);
    }

    // Full BFS batch for non-cached roots
    private bfsBatch(from: string, targets: string[], maxHops: number, includePaths: boolean): Map<string, DistanceInfo | null> {
        const fromId = storage.getId(from);
        const results = new Map<string, DistanceInfo | null>();

        if (fromId === null) {
            for (const t of targets) results.set(t, null);
            return results;
        }

        const targetIds = new Map<number, string>();
        for (const target of targets) {
            if (from === target) {
                results.set(target, { hops: 0, paths: includePaths ? 1 : null });
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

        const visited = new Set<number>([fromId]);
        let frontier: number[] = [fromId];
        let hop = 0;
        const pathCount: Map<number, number> | null = includePaths ? new Map([[fromId, 1]]) : null;
        const foundTargetPaths: Map<number, number> | null = includePaths ? new Map() : null;
        const foundAtHop = new Map<number, number>();

        while (frontier.length > 0 && hop < maxHops && targetIds.size > 0) {
            hop++;
            const nextFrontier: number[] = [];
            const nextPathCount: Map<number, number> | null = includePaths ? new Map() : null;

            for (const nodeId of frontier) {
                const currentPaths = includePaths ? (pathCount!.get(nodeId) || 1) : 0;
                const followIds = storage.getFollowIdsSync(nodeId);

                for (let i = 0; i < followIds.length; i++) {
                    const fid = followIds[i];

                    if (targetIds.has(fid)) {
                        if (includePaths) {
                            foundTargetPaths!.set(fid, (foundTargetPaths!.get(fid) || 0) + currentPaths);
                            if (!foundAtHop.has(fid)) foundAtHop.set(fid, hop);
                        } else {
                            results.set(targetIds.get(fid)!, { hops: hop, paths: null });
                            targetIds.delete(fid);
                        }
                    }

                    if (!visited.has(fid)) {
                        visited.add(fid);
                        nextFrontier.push(fid);
                        if (includePaths) {
                            nextPathCount!.set(fid, (nextPathCount!.get(fid) || 0) + currentPaths);
                        }
                    } else if (includePaths && nextPathCount!.has(fid)) {
                        nextPathCount!.set(fid, nextPathCount!.get(fid)! + currentPaths);
                    }
                }
            }

            if (includePaths) {
                for (const [tid, h] of foundAtHop) {
                    if (h === hop && targetIds.has(tid)) {
                        results.set(targetIds.get(tid)!, { hops: hop, paths: foundTargetPaths!.get(tid)! });
                        targetIds.delete(tid);
                    }
                }
            }

            frontier = nextFrontier;
            if (includePaths) {
                for (const [id, count] of nextPathCount!) {
                    pathCount!.set(id, count);
                }
            }
        }

        for (const [, target] of targetIds) {
            results.set(target, null);
        }

        return results;
    }

    // Check if target is within maxHops -- uses cache for O(1) lookup
    async isWithinHops(from: string, to: string, maxHops: number = 3): Promise<boolean> {
        await this.ensureReady();
        this.ensureCache(from, maxHops);

        const cached = this.getCached(from, to);
        if (cached !== undefined) return cached !== null && cached.hops <= maxHops;

        // Fallback BFS
        if (from === to) return true;

        const fromId = storage.getId(from);
        const toId = storage.getId(to);
        if (fromId === null || toId === null) return false;

        const visited = new Set<number>([fromId]);
        let frontier: number[] = [fromId];
        let hop = 0;

        while (frontier.length > 0 && hop < maxHops) {
            hop++;
            const nextFrontier: number[] = [];
            for (const nodeId of frontier) {
                const followIds = storage.getFollowIdsSync(nodeId);
                for (let i = 0; i < followIds.length; i++) {
                    if (followIds[i] === toId) return true;
                    if (!visited.has(followIds[i])) {
                        visited.add(followIds[i]);
                        nextFrontier.push(followIds[i]);
                    }
                }
            }
            frontier = nextFrontier;
        }
        return false;
    }

    // Get an actual path from source to target
    async getPath(from: string, to: string, maxHops: number = 6): Promise<string[] | null> {
        await this.ensureReady();

        if (from === to) return [from];

        const fromId = storage.getId(from);
        const toId = storage.getId(to);
        if (fromId === null || toId === null) return null;

        // BFS with parent tracking
        const parent = new Map<number, number | null>([[fromId, null]]);
        const visited = new Set<number>([fromId]);
        let frontier: number[] = [fromId];
        let hop = 0;
        let found = false;

        while (frontier.length > 0 && hop < maxHops && !found) {
            hop++;
            const nextFrontier: number[] = [];
            for (const nodeId of frontier) {
                const followIds = storage.getFollowIdsSync(nodeId);
                for (let i = 0; i < followIds.length; i++) {
                    const fid = followIds[i];
                    if (!visited.has(fid)) {
                        visited.add(fid);
                        parent.set(fid, nodeId);
                        if (fid === toId) { found = true; break; }
                        nextFrontier.push(fid);
                    }
                }
                if (found) break;
            }
            frontier = nextFrontier;
        }

        if (!found) return null;

        const pathIds: number[] = [];
        let current: number | null = toId;
        while (current !== null) {
            pathIds.unshift(current);
            current = parent.get(current) ?? null;
        }
        return pathIds.map(id => storage.getPubkey(id)).filter(Boolean) as string[];
    }

    async getFollows(pubkey: string): Promise<string[]> {
        await this.ensureReady();
        return storage.getFollows(pubkey);
    }

    async getCommonFollows(from: string, to: string): Promise<string[]> {
        await this.ensureReady();

        const fromId = storage.getId(from);
        const toId = storage.getId(to);
        if (fromId === null || toId === null) return [];

        const fromFollows = storage.getFollowIdsSync(fromId);
        const toFollows = storage.getFollowIdsSync(toId);
        const toSet = new Set(toFollows);

        const common: string[] = [];
        for (let i = 0; i < fromFollows.length; i++) {
            if (toSet.has(fromFollows[i])) {
                const pk = storage.getPubkey(fromFollows[i]);
                if (pk) common.push(pk);
            }
        }
        return common;
    }
}
