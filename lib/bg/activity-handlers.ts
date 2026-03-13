/**
 * Activity log handlers: log, retrieve, and clear the activity log.
 * @module lib/bg/activity-handlers
 */

import browser from '../browser.ts';
import { config, type HandlerFn } from './state.ts';
import { ACTIVITY_LOG_MAX_PER_DOMAIN } from '../constants.ts';

// ── Types ──

interface ActivityEntry {
    domain?: string;
    method: string;
    decision: string;
    kind?: number;
    event?: Record<string, unknown>;
    theirPubkey?: string;
}

interface StoredActivityEntry {
    timestamp: number;
    domain?: string;
    method: string;
    kind?: number | null;
    decision: string;
    pubkey?: string | null;
    event?: { tags?: string[][] } & Record<string, unknown>;
    theirPubkey?: string;
}

// ── Activity Log ──

export async function logActivity(entry: ActivityEntry): Promise<void> {
    try {
        const data = await browser.storage.local.get(['activityLog']) as Record<string, Array<Record<string, unknown>>>;
        const log = data.activityLog || [];
        log.unshift({
            timestamp: Date.now(),
            domain: entry.domain,
            method: entry.method,
            kind: entry.kind ?? null,
            decision: entry.decision,
            pubkey: config.myPubkey || null,
            ...(entry.event && { event: entry.event }),
            ...(entry.theirPubkey && { theirPubkey: entry.theirPubkey }),
        });
        // Keep max 200 entries per domain
        const domainCounts: Record<string, number> = {};
        const trimmed = log.filter((e) => {
            const d = (e.domain as string) || '?';
            domainCounts[d] = (domainCounts[d] || 0) + 1;
            return domainCounts[d] <= ACTIVITY_LOG_MAX_PER_DOMAIN;
        });
        await browser.storage.local.set({ activityLog: trimmed });
    } catch { /* ignored */ }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getActivityLog', async () => {
        const logData = await browser.storage.local.get(['activityLog']) as Record<string, unknown[]>;
        return logData.activityLog || [];
    }],

    ['clearActivityLog', async (params) => {
        const hasFilter = params.domain || params.accountPubkey || params.typeFilter || params.pubkeyFilter;
        if (!hasFilter) {
            await browser.storage.local.remove('activityLog');
        } else {
            const allLog = ((await browser.storage.local.get(['activityLog'])) as Record<string, StoredActivityEntry[]>).activityLog || [];
            const typeMethods: Record<string, string[]> = {
                signEvent: ['signEvent'], getPublicKey: ['getPublicKey'],
                encrypt: ['nip04Encrypt', 'nip44Encrypt'], decrypt: ['nip04Decrypt', 'nip44Decrypt'],
                nip04Encrypt: ['nip04Encrypt'], nip04Decrypt: ['nip04Decrypt'],
                nip44Encrypt: ['nip44Encrypt'], nip44Decrypt: ['nip44Decrypt'],
            };
            const kept = allLog.filter((e: StoredActivityEntry) => {
                if (params.accountPubkey && e.pubkey !== params.accountPubkey) return true;
                if (params.domain && e.domain !== params.domain) return true;
                if (params.typeFilter) {
                    const methods = typeMethods[params.typeFilter as string];
                    if (methods && !methods.includes(e.method)) return true;
                }
                if (params.pubkeyFilter) {
                    const q = (params.pubkeyFilter as string).toLowerCase();
                    let matches = false;
                    if (e.theirPubkey && e.theirPubkey.toLowerCase().includes(q)) matches = true;
                    if (!matches && e.event?.tags) {
                        for (const tag of e.event.tags) {
                            if (tag[0] === 'p' && tag[1] && tag[1].toLowerCase().includes(q)) { matches = true; break; }
                        }
                    }
                    if (!matches) return true;
                }
                return false;
            });
            await browser.storage.local.set({ activityLog: kept });
        }
        return { ok: true };
    }],
]);
