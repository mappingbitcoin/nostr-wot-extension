/**
 * Profile metadata, mute list, and local block handlers.
 * @module lib/bg/profile-handlers
 */

import browser from '../browser.ts';
import { randomHex } from '../crypto/utils.ts';
import { config, DEFAULT_RELAYS, profileCache, PROFILE_CACHE_TTL, type HandlerFn, type ProfileCacheEntry } from './state.ts';

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

    ['updateProfileCache', async (params) => {
        const { pubkey, metadata } = params as { pubkey: string; metadata: Record<string, unknown> };
        if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata');
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
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
]);
