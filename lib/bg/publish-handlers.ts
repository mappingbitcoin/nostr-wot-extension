/**
 * Event broadcasting, relay publishing, event signing, NIP-46 session management,
 * and health check handlers.
 * @module lib/bg/publish-handlers
 */

import browser from '../browser.ts';
import { RemoteOracle } from '../api.ts';
import { signEvent } from '../crypto/nip01.ts';
import * as vault from '../vault.ts';
import * as signer from '../signer.ts';
import { config, type HandlerFn } from './state.ts';
import { triggerAutoSyncIfEnabled } from './wot-handlers.ts';
import type { UnsignedEvent, SignedEvent } from '../types.ts';

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

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
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
            const broadcastUrls = relayUrls.length > 0 ? relayUrls : config.relays;
            const result = await broadcastEvent(signed, broadcastUrls);

            await browser.storage.local.set({
                lastRelayPublish: Date.now(),
                lastPublishedRelays: relaysCsv
            });

            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
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
