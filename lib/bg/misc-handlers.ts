/**
 * Miscellaneous handlers: activity log, mute lists, local blocks,
 * profile metadata, NIP-46 sessions, relay/event publishing, health checks.
 * @module lib/bg/misc-handlers
 */

import browser from '../browser.ts';
import { RemoteOracle } from '../api.ts';
import { randomHex } from '../crypto/utils.ts';
import { signEvent } from '../crypto/nip01.ts';
import * as vault from '../vault.ts';
import * as signer from '../signer.ts';
import { config, DEFAULT_RELAYS, profileCache, PROFILE_CACHE_TTL, type HandlerFn, type ProfileCacheEntry } from './state.ts';
import { triggerAutoSyncIfEnabled } from './wot-handlers.ts';
import type { UnsignedEvent, SignedEvent } from '../types.ts';

// ── Types ──

interface ActivityEntry {
    domain?: string;
    method: string;
    decision: string;
    kind?: number;
    event?: Record<string, unknown>;
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
            return domainCounts[d] <= 200;
        });
        await browser.storage.local.set({ activityLog: trimmed });
    } catch { /* ignored */ }
}

// ── Event Broadcasting ──

export async function broadcastEvent(signedEvent: SignedEvent, relayUrls: string[]): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const promises = relayUrls.map(url => new Promise<void>((resolve) => {
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch { /* ignored */ }
                results.failed++;
                resolve();
            }, 5000);

            ws.onopen = () => {
                try {
                    ws.send(JSON.stringify(['EVENT', signedEvent]));
                } catch {
                    clearTimeout(timeout);
                    results.failed++;
                    resolve();
                    return;
                }
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg[0] === 'OK' && msg[1] === signedEvent.id) {
                        clearTimeout(timeout);
                        if (msg[2] === true) results.sent++;
                        else results.failed++;
                        try { ws.close(); } catch { /* ignored */ }
                        resolve();
                    }
                } catch { /* ignored */ }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                results.failed++;
                resolve();
            };
        } catch {
            results.failed++;
            resolve();
        }
    }));

    await Promise.all(promises);
    return results;
}

// ── Profile Metadata ──

export async function fetchProfileMetadata(pubkey: string): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null;

    const cached = profileCache.get(pubkey);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
        return cached.metadata;
    }

    const storageKey = `profile_${pubkey}`;
    const stored = await browser.storage.local.get(storageKey) as Record<string, ProfileCacheEntry>;
    if (stored[storageKey] && Date.now() - stored[storageKey].fetchedAt < PROFILE_CACHE_TTL) {
        profileCache.set(pubkey, stored[storageKey]);
        return stored[storageKey].metadata;
    }

    const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
    const metadata = await fetchKind0(pubkey, relays);

    if (metadata) {
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [storageKey]: entry });
    }

    return metadata;
}

export function fetchKind0(pubkey: string, relayUrls: string[]): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        let best: Record<string, unknown> | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(best); }
        };

        const timer = setTimeout(done, 5000);

        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'p' + randomHex(6);
                let closed = false;

                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey !== pubkey || event.kind !== 0) return;
                            if (event.created_at > bestCreatedAt) {
                                bestCreatedAt = event.created_at;
                                best = JSON.parse(event.content);
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignore parse errors */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 4000);
            } catch {
                checkRemaining();
            }
        }
    });
}

export function fetchMuteList(pubkey: string, relayUrls: string[]): Promise<string[] | null> {
    return new Promise((resolve) => {
        let bestTags: string[] | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(bestTags); }
        };
        const timer = setTimeout(done, 8000);
        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'm' + randomHex(6);
                let closed = false;
                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [10000], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey === pubkey && event.kind === 10000 && event.created_at > bestCreatedAt) {
                                bestCreatedAt = event.created_at;
                                bestTags = (event.tags || []).filter((t: string[]) => t[0] === 'p' && t[1]).map((t: string[]) => t[1]);
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignored */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 6000);
            } catch {
                checkRemaining();
            }
        }
    });
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
            const allLog = ((await browser.storage.local.get(['activityLog'])) as Record<string, any[]>).activityLog || [];
            const typeMethods: Record<string, string[]> = {
                signEvent: ['signEvent'], getPublicKey: ['getPublicKey'],
                encrypt: ['nip04Encrypt', 'nip44Encrypt'], decrypt: ['nip04Decrypt', 'nip44Decrypt'],
                nip04Encrypt: ['nip04Encrypt'], nip04Decrypt: ['nip04Decrypt'],
                nip44Encrypt: ['nip44Encrypt'], nip44Decrypt: ['nip44Decrypt'],
            };
            const kept = allLog.filter((e: any) => {
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

    ['getLocalBlocks', async () => {
        const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string }>>;
        return blockData.localBlocks || [];
    }],

    ['addLocalBlock', async (params) => {
        const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string; note: string; addedAt: number }>>;
        const blocks = blockData.localBlocks || [];
        const pubkey = params.pubkey as string;
        if (!pubkey || blocks.some(b => b.pubkey === pubkey)) return { ok: false, error: 'Already blocked or invalid' };
        blocks.push({ pubkey, note: (params.note as string) || '', addedAt: Date.now() });
        await browser.storage.local.set({ localBlocks: blocks });
        return { ok: true };
    }],

    ['removeLocalBlock', async (params) => {
        const blockData = await browser.storage.local.get(['localBlocks']) as Record<string, Array<{ pubkey: string }>>;
        const blocks = (blockData.localBlocks || []).filter(b => b.pubkey !== params.pubkey);
        await browser.storage.local.set({ localBlocks: blocks });
        return { ok: true };
    }],

    ['fetchMuteList', async (params) => {
        const pubkeys = await fetchMuteList(params.pubkey as string, config.relays);
        if (pubkeys === null) return { ok: false, error: 'Could not fetch mute list' };
        return { ok: true, count: pubkeys.length, pubkeys };
    }],

    ['getMuteLists', async () => {
        const data = await browser.storage.local.get(['muteLists']) as Record<string, unknown[]>;
        return data.muteLists || [];
    }],

    ['removeMuteList', async (params) => {
        const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string }>>;
        const lists = (data.muteLists || []).filter(l => l.pubkey !== params.pubkey);
        await browser.storage.local.set({ muteLists: lists });
        return { ok: true };
    }],

    ['toggleMuteList', async (params) => {
        const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string; enabled: boolean }>>;
        const lists = data.muteLists || [];
        const list = lists.find(l => l.pubkey === params.pubkey);
        if (list) {
            list.enabled = !list.enabled;
            await browser.storage.local.set({ muteLists: lists });
        }
        return { ok: true };
    }],

    ['saveMuteList', async (params) => {
        const data = await browser.storage.local.get(['muteLists']) as Record<string, Array<{ pubkey: string; name: string; entries: unknown; enabled: boolean; syncedAt: number }>>;
        const lists = data.muteLists || [];
        if (lists.some(l => l.pubkey === params.pubkey)) return { ok: false, error: 'Already imported' };
        lists.push({
            pubkey: params.pubkey as string,
            name: (params.name as string) || (params.pubkey as string).slice(0, 8) + '...',
            entries: params.entries,
            enabled: true,
            syncedAt: Date.now()
        });
        await browser.storage.local.set({ muteLists: lists });
        return { ok: true };
    }],

    ['nip46_getSessionInfo', async () => {
        const nip46Data = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const nip46Acct = nip46Data.activeAccountId
            ? vault.getAccountById(nip46Data.activeAccountId)
            : null;
        if (!nip46Acct || nip46Acct.type !== 'nip46') return null;

        const nip46Config = nip46Acct.nip46Config;
        if (!nip46Config) return null;

        const clientConnected = signer.isNip46Connected(nip46Acct.id);

        return {
            bunkerPubkey: nip46Acct.pubkey,
            relay: nip46Config.relay,
            connected: clientConnected,
            accountId: nip46Acct.id,
            accountName: nip46Acct.name
        };
    }],

    ['nip46_revokeSession', async (params) => {
        signer.disconnectNip46(params.accountId as string);
        return { ok: true };
    }],

    ['publishRelayList', async () => {
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked or no private key');

        try {
            const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
            const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
            const relaysCsv = relayData.relays || '';
            const relayUrls = relaysCsv.split(',').map(r => r.trim()).filter(Boolean);
            const flags = flagData.relayFlags || {};

            const tags: string[][] = [];
            for (const url of relayUrls) {
                const f = flags[url] || { read: true, write: true };
                if (f.read && f.write) {
                    tags.push(['r', url]);
                } else if (f.read) {
                    tags.push(['r', url, 'read']);
                } else if (f.write) {
                    tags.push(['r', url, 'write']);
                }
            }

            const event: UnsignedEvent = {
                created_at: Math.floor(Date.now() / 1000),
                kind: 10002,
                tags,
                content: ''
            };

            const signed = await signEvent(event, privkeyBytes);
            privkeyBytes.fill(0);

            const broadcastUrls = relayUrls.length > 0 ? relayUrls : config.relays;
            const result = await broadcastEvent(signed, broadcastUrls);

            await browser.storage.local.set({
                lastRelayPublish: Date.now(),
                lastPublishedRelays: relaysCsv
            });

            return { ok: true, sent: result.sent, failed: result.failed };
        } catch (e) {
            privkeyBytes.fill(0);
            throw e;
        }
    }],

    ['signEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            return await signEvent(params.event as UnsignedEvent, privkeyBytes);
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['signAndPublishEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            const signed = await signEvent(params.event as UnsignedEvent, privkeyBytes);
            const result = await broadcastEvent(signed, config.relays);
            if ((params.event as UnsignedEvent).kind === 3) {
                triggerAutoSyncIfEnabled();
            }
            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['updateProfileCache', async (params) => {
        const { pubkey, metadata } = params as { pubkey: string; metadata: Record<string, unknown> };
        if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata');
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
        return { ok: true };
    }],

    ['getProfileMetadata', async (params) => fetchProfileMetadata(params.pubkey as string)],

    ['getProfileMetadataBatch', async (params) => {
        const pubkeys = params.pubkeys as string[];
        if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');
        const results: Record<string, Record<string, unknown> | null> = {};
        await Promise.all(pubkeys.map(async (pk) => {
            results[pk] = await fetchProfileMetadata(pk);
        }));
        return results;
    }],

    ['checkRelayHealth', async (params) => {
        const { url } = params as { url: string };
        try {
            const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
            const res = await fetch(httpUrl, {
                headers: { 'Accept': 'application/nostr+json' },
                signal: AbortSignal.timeout(5000)
            });
            return { reachable: res.ok };
        } catch {
            return { reachable: false };
        }
    }],

    ['checkOracleHealth', async (params) => {
        const { url } = params as { url: string };
        try {
            const o = new RemoteOracle(url);
            const healthy = await o.isHealthy();
            return { reachable: healthy };
        } catch {
            return { reachable: false };
        }
    }],
]);
