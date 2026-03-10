/**
 * WoT graph query handlers.
 * @module lib/bg/wot-handlers
 */

import { GraphSync, isSyncInProgress, stopSync } from '../sync.ts';
import { calculateScore } from '../scoring.ts';
import * as storage from '../storage.ts';
import { config, oracle, localGraph, type HandlerFn } from './state.ts';
import browser from '../browser.ts';

// ── Types ──

interface DistanceInfo {
    hops: number;
    paths?: number | null;
    score?: number;
}

interface BatchOptions {
    includePaths?: boolean;
    includeScores?: boolean;
}

// ── Core graph functions ──

export async function getDistance(from: string, to: string): Promise<number | null> {
    if (!from) throw new Error('My pubkey not configured');

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        return localGraph!.getDistance(from, to, config.maxHops);
    }

    if (config.mode === 'remote') {
        return oracle!.getDistance(from, to);
    }

    // Hybrid: try local first, fall back to remote
    await localGraph!.ensureReady();
    const local = await localGraph!.getDistance(from, to, config.maxHops);
    if (local !== null) return local;
    return oracle!.getDistance(from, to);
}

export async function getDetails(from: string, to: string): Promise<{ hops: number; paths: number | null; score: number } | null> {
    if (!from) throw new Error('My pubkey not configured');

    let info: DistanceInfo | null;

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        info = await localGraph!.getDistanceInfo(from, to, config.maxHops);
    } else if (config.mode === 'remote') {
        info = await oracle!.getDistanceInfo(from, to);
    } else {
        await localGraph!.ensureReady();
        info = await localGraph!.getDistanceInfo(from, to, config.maxHops);
        if (info === null) {
            info = await oracle!.getDistanceInfo(from, to);
        }
    }

    if (!info) return null;

    const hops = info.hops;
    const paths = info.paths ?? null;
    const score = calculateScore(hops, paths, config.scoring);

    return { hops, paths, score };
}

export async function getTrustScore(from: string, to: string): Promise<number | null> {
    if (!from) throw new Error('My pubkey not configured');

    const details = await getDetails(from, to);
    if (!details || details.hops === null) return null;

    return details.score;
}

export async function triggerAutoSyncIfEnabled(): Promise<void> {
    try {
        const data = await browser.storage.sync.get(['autoSyncOnFollowChange']) as Record<string, boolean>;
        if (!data.autoSyncOnFollowChange) return;
        if (isSyncInProgress()) return;
        syncGraph(2);
    } catch (e: unknown) {
        console.warn('[WOT] Auto-sync trigger failed:', (e as Error).message);
    }
}

export async function syncGraph(depth: number): Promise<unknown> {
    if (!config.myPubkey) {
        throw new Error('My pubkey not configured');
    }

    if (config.relays.length === 0) {
        throw new Error('No relays configured');
    }

    const localData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
    if (localData.activeAccountId) {
        await storage.initDB(localData.activeAccountId);
    }

    const sync = new GraphSync(config.relays);

    sync.onProgress = (progress: unknown) => {
        browser.runtime.sendMessage({
            type: 'syncProgress',
            progress
        }).catch(() => {});
    };

    return await sync.syncFromPubkey(config.myPubkey, depth);
}

export async function clearGraph(): Promise<{ ok: boolean }> {
    await storage.clearAll();
    return { ok: true };
}

export function formatSingleResult(info: DistanceInfo, opts: BatchOptions): unknown {
    const { includePaths, includeScores } = opts;

    if (!includePaths && !includeScores) {
        return info.hops;
    }

    const result: Record<string, unknown> = { hops: info.hops };

    if (includePaths) {
        result.paths = info.paths ?? null;
    }

    if (includeScores) {
        result.score = calculateScore(info.hops, info.paths ?? null, config.scoring);
    }

    return result;
}

export function formatBatchResults(results: Map<string, DistanceInfo | null>, opts: BatchOptions): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [pubkey, info] of results) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

function formatBatchResultsFromDetails(results: Record<string, DistanceInfo | null>, opts: BatchOptions): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [pubkey, info] of Object.entries(results)) {
        obj[pubkey] = info ? formatSingleResult(info, opts) : null;
    }
    return obj;
}

async function getDetailsBatchRemote(targets: string[]): Promise<Record<string, DistanceInfo | null>> {
    const results: Record<string, DistanceInfo | null> = {};
    const CONCURRENCY = 5;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (target): Promise<[string, DistanceInfo | null]> => {
            try {
                const info = await oracle!.getDistanceInfo(config.myPubkey!, target);
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

export async function getDistanceBatch(targets: string[], options: BatchOptions = {}): Promise<Record<string, unknown>> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    const opts: BatchOptions = typeof options === 'boolean'
        ? { includePaths: options, includeScores: false }
        : { includePaths: false, includeScores: false, ...options };

    const { includePaths, includeScores } = opts;
    const needDetails = includePaths || includeScores;

    if (config.mode === 'local') {
        await localGraph!.ensureReady();
        const results = await localGraph!.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);
        return formatBatchResults(results, opts);
    }

    if (config.mode === 'remote') {
        if (needDetails) {
            const results = await getDetailsBatchRemote(targets);
            return formatBatchResultsFromDetails(results, opts);
        }
        return oracle!.getDistanceBatch(config.myPubkey, targets);
    }

    // Hybrid: try local first, then remote for missing
    await localGraph!.ensureReady();
    const localResults = await localGraph!.getDistancesBatch(config.myPubkey, targets, config.maxHops, needDetails);

    const obj: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const [pubkey, info] of localResults) {
        if (info !== null) {
            obj[pubkey] = formatSingleResult(info as DistanceInfo, opts);
        } else {
            missing.push(pubkey);
        }
    }

    if (missing.length > 0) {
        try {
            if (needDetails) {
                const remoteResults = await getDetailsBatchRemote(missing);
                for (const [pubkey, details] of Object.entries(remoteResults)) {
                    obj[pubkey] = details ? formatSingleResult(details as DistanceInfo, opts) : null;
                }
            } else {
                const remoteResults = await oracle!.getDistanceBatch(config.myPubkey, missing);
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

export async function getTrustScoreBatch(targets: string[]): Promise<Record<string, number | null>> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(targets)) throw new Error('targets must be an array');

    const results = await getDistanceBatch(targets, { includePaths: true, includeScores: true });
    const scores: Record<string, number | null> = {};

    for (const [pubkey, info] of Object.entries(results)) {
        scores[pubkey] = info ? (info as { score: number }).score : null;
    }

    return scores;
}

export async function filterByWoT(pubkeys: string[], maxHops?: number): Promise<string[]> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');

    const hops = maxHops ?? config.maxHops;
    const distances = await getDistanceBatch(pubkeys);

    return pubkeys.filter(pubkey => {
        const dist = distances[pubkey] as number | null;
        return dist !== null && dist <= hops;
    });
}

async function getFollowsForPubkey(pubkey: string): Promise<string[]> {
    const targetPubkey = pubkey || config.myPubkey;
    if (!targetPubkey) throw new Error('No pubkey specified');

    if (config.mode === 'remote') {
        return oracle!.getFollows(targetPubkey);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getFollows(targetPubkey);
        if (local && local.length > 0) return local;
        return oracle!.getFollows(targetPubkey);
    }

    await localGraph!.ensureReady();
    return localGraph!.getFollows(targetPubkey);
}

async function getCommonFollows(targetPubkey: string): Promise<string[]> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!targetPubkey) throw new Error('No target pubkey specified');

    if (config.mode === 'remote') {
        return oracle!.getCommonFollows(config.myPubkey, targetPubkey);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getCommonFollows(config.myPubkey, targetPubkey);
        if (local && local.length > 0) return local;
        return oracle!.getCommonFollows(config.myPubkey, targetPubkey);
    }

    await localGraph!.ensureReady();
    return localGraph!.getCommonFollows(config.myPubkey, targetPubkey);
}

async function getPathTo(target: string): Promise<string[] | null> {
    if (!config.myPubkey) throw new Error('My pubkey not configured');
    if (!target) throw new Error('No target specified');

    if (config.mode === 'remote') {
        return oracle!.getPath(config.myPubkey, target);
    }

    if (config.mode === 'hybrid') {
        await localGraph!.ensureReady();
        const local = await localGraph!.getPath(config.myPubkey, target, config.maxHops);
        if (local) return local;
        return oracle!.getPath(config.myPubkey, target);
    }

    await localGraph!.ensureReady();
    return localGraph!.getPath(config.myPubkey, target, config.maxHops);
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getDistance', async (params) => getDistance(config.myPubkey!, params.target as string)],

    ['isInMyWoT', async (params) => {
        const dist = await getDistance(config.myPubkey!, params.target as string);
        const hops = (params.maxHops as number) ?? config.maxHops;
        return dist !== null && dist <= hops;
    }],

    ['getTrustScore', async (params) => getTrustScore(config.myPubkey!, params.target as string)],

    ['getDetails', async (params) => getDetails(config.myPubkey!, params.target as string)],

    ['syncGraph', async (params) => syncGraph((params?.depth as number) || 2)],

    ['stopSync', async () => { stopSync(); return { ok: true }; }],

    ['getSyncState', async () => ({
        inProgress: isSyncInProgress(),
        state: await storage.getMeta('syncState')
    })],

    ['clearGraph', async () => clearGraph()],

    ['getStats', async () => storage.getStats()],

    ['getConfig', async () => ({
        maxHops: config.maxHops,
        timeout: config.timeout,
        scoring: config.scoring
    })],

    ['getStatus', async () => ({
        configured: !!config.myPubkey,
        mode: config.mode,
        hasLocalGraph: (await storage.getStats()).nodes > 0
    })],

    ['getDistanceBatch', async (params) => {
        return getDistanceBatch(params.targets as string[], {
            includePaths: params.includePaths as boolean,
            includeScores: params.includeScores as boolean
        });
    }],

    ['getTrustScoreBatch', async (params) => {
        return getTrustScoreBatch(params.targets as string[]);
    }],

    ['filterByWoT', async (params) => filterByWoT(params.pubkeys as string[], params.maxHops as number | undefined)],

    ['getFollows', async (params) => getFollowsForPubkey(params.pubkey as string)],

    ['getCommonFollows', async (params) => getCommonFollows(params.pubkey as string)],

    ['getPath', async (params) => getPathTo(params.target as string)],
]);
