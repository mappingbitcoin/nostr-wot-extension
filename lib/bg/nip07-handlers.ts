/**
 * NIP-07 signer + permission management handlers.
 * @module lib/bg/nip07-handlers
 */

import browser from '../browser.ts';
import * as signer from '../signer.ts';
import * as signerPermissions from '../permissions.ts';
import type { UnsignedEvent, RequestDecision } from '../types.ts';
import type { HandlerFn } from './state.ts';
import { isIdentityDisabled, addAllowedDomain } from './domain-handlers.ts';
import { logActivity } from './misc-handlers.ts';
import { triggerAutoSyncIfEnabled } from './wot-handlers.ts';

// ── Validation ──

export function validateNip07Params(method: string, params: Record<string, unknown>): void {
    if (method === 'nip07_signEvent') {
        const evt = params.event;
        if (!evt || typeof evt !== 'object') throw new Error('Invalid event');
        const e = evt as Record<string, unknown>;
        if (typeof e.kind !== 'number' || !Number.isInteger(e.kind) || e.kind < 0)
            throw new Error('Invalid event kind');
        if (typeof e.content !== 'string') throw new Error('Invalid event content');
    }
    if (method === 'nip07_nip04Encrypt' || method === 'nip07_nip44Encrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        if (typeof params.plaintext !== 'string') throw new Error('Invalid plaintext');
    }
    if (method === 'nip07_nip04Decrypt' || method === 'nip07_nip44Decrypt') {
        if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
            throw new Error('Invalid pubkey');
        if (typeof params.ciphertext !== 'string') throw new Error('Invalid ciphertext');
    }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['nip07_getPublicKey', async (params) => {
        const origin = params.origin as string;
        if (origin && await isIdentityDisabled(origin)) {
            logActivity({ domain: origin, method: 'getPublicKey', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleGetPublicKey(origin);
            logActivity({ domain: origin, method: 'getPublicKey', decision: 'approved' });
            if (origin) addAllowedDomain(origin).catch(() => {});
            return result;
        } catch (e) {
            logActivity({ domain: origin, method: 'getPublicKey', decision: 'rejected' });
            throw e;
        }
    }],

    ['nip07_signEvent', async (params) => {
        if (params.origin && await isIdentityDisabled(params.origin as string)) {
            logActivity({ domain: params.origin as string, method: 'signEvent', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleSignEvent(params.event as UnsignedEvent, params.origin as string);
            logActivity({ domain: params.origin as string, method: 'signEvent', kind: (params.event as Record<string, unknown>)?.kind as number, decision: 'approved', event: params.event as Record<string, unknown> });
            if ((params.event as Record<string, unknown>)?.kind === 3) {
                triggerAutoSyncIfEnabled();
            }
            return result;
        } catch (e) {
            console.error('[nip07] signEvent FAILED, kind:', (params.event as Record<string, unknown>)?.kind, 'error:', (e as Error).message);
            logActivity({ domain: params.origin as string, method: 'signEvent', kind: (params.event as Record<string, unknown>)?.kind as number, decision: 'rejected', event: params.event as Record<string, unknown> });
            throw e;
        }
    }],

    ['nip07_getRelays', async () => {
        const data = await browser.storage.sync.get('relays') as Record<string, string>;
        const relayList = data.relays ? data.relays.split(',').map(r => r.trim()).filter(Boolean) : [];
        const relayObj: Record<string, { read: boolean; write: boolean }> = {};
        for (const r of relayList) relayObj[r] = { read: true, write: true };
        return relayObj;
    }],

    ['nip07_nip04Encrypt', async (params) => {
        const nip07Origin = params.origin as string;
        if (nip07Origin && await isIdentityDisabled(nip07Origin)) {
            logActivity({ domain: nip07Origin, method: 'nip04Encrypt', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleNip04Encrypt(params.pubkey as string, params.plaintext as string, nip07Origin);
            logActivity({ domain: nip07Origin, method: 'nip04Encrypt', decision: 'approved', theirPubkey: params.pubkey as string });
            return result;
        } catch (e) {
            logActivity({ domain: nip07Origin, method: 'nip04Encrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
            throw e;
        }
    }],

    ['nip07_nip04Decrypt', async (params) => {
        const nip07Origin = params.origin as string;
        if (nip07Origin && await isIdentityDisabled(nip07Origin)) {
            logActivity({ domain: nip07Origin, method: 'nip04Decrypt', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleNip04Decrypt(params.pubkey as string, params.ciphertext as string, nip07Origin);
            logActivity({ domain: nip07Origin, method: 'nip04Decrypt', decision: 'approved', theirPubkey: params.pubkey as string });
            return result;
        } catch (e) {
            logActivity({ domain: nip07Origin, method: 'nip04Decrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
            throw e;
        }
    }],

    ['nip07_nip44Encrypt', async (params) => {
        const nip07Origin = params.origin as string;
        if (nip07Origin && await isIdentityDisabled(nip07Origin)) {
            logActivity({ domain: nip07Origin, method: 'nip44Encrypt', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleNip44Encrypt(params.pubkey as string, params.plaintext as string, nip07Origin);
            logActivity({ domain: nip07Origin, method: 'nip44Encrypt', decision: 'approved', theirPubkey: params.pubkey as string });
            return result;
        } catch (e) {
            logActivity({ domain: nip07Origin, method: 'nip44Encrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
            throw e;
        }
    }],

    ['nip07_nip44Decrypt', async (params) => {
        const nip07Origin = params.origin as string;
        if (nip07Origin && await isIdentityDisabled(nip07Origin)) {
            logActivity({ domain: nip07Origin, method: 'nip44Decrypt', decision: 'blocked' });
            throw new Error('Identity access disabled for this site');
        }
        try {
            const result = await signer.handleNip44Decrypt(params.pubkey as string, params.ciphertext as string, nip07Origin);
            logActivity({ domain: nip07Origin, method: 'nip44Decrypt', decision: 'approved', theirPubkey: params.pubkey as string });
            return result;
        } catch (e) {
            logActivity({ domain: nip07Origin, method: 'nip44Decrypt', decision: 'rejected', theirPubkey: params.pubkey as string });
            throw e;
        }
    }],

    // ── Signer permission management ──

    ['signer_getPermissions', async (params) => signerPermissions.getAll(params.accountId as string)],
    ['signer_getPermissionsForDomain', async (params) => signerPermissions.getForDomain(params.domain as string, params.accountId as string)],

    ['signer_clearPermissions', async (params) => {
        await signerPermissions.clear(params.domain as string, params.accountId as string);
        return { ok: true };
    }],

    ['signer_savePermission', async (params) => {
        await signerPermissions.saveDirect(params.domain as string, params.methodName as string, params.decision as 'allow' | 'deny' | 'ask', params.accountId as string);
        return { ok: true };
    }],

    ['signer_getPermissionsRaw', async () => signerPermissions.getAllRaw()],
    ['signer_getPermissionsForDomainRaw', async (params) => signerPermissions.getForDomainRaw(params.domain as string)],

    ['signer_copyPermissions', async (params) => {
        await signerPermissions.copyPermissions(params.fromAccountId as string, params.toAccountId as string);
        return { ok: true };
    }],

    ['signer_getUseGlobalDefaults', async () => signerPermissions.getUseGlobalDefaults()],

    ['signer_setUseGlobalDefaults', async (params) => {
        await signerPermissions.setUseGlobalDefaults(params.enabled as boolean);
        return { ok: true };
    }],

    // ── Signer pending request management ──

    ['signer_getPending', async () => signer.getPending()],

    ['signer_resolve', async (params) => {
        signer.resolveRequest(params.id as string, params.decision as unknown as RequestDecision);
        return { ok: true };
    }],

    ['signer_resolveBatch', async (params) => {
        await signer.resolveBatch(params.origin as string, params.method as string, params.decision as unknown as RequestDecision, params.eventKind as number | undefined);
        return { ok: true };
    }],

    ['signer_cancelNip46', async (params) => {
        await signer.cancelNip46InFlight(params.id as string);
        return { ok: true };
    }],

    ['signer_cancelUnlockWaiters', async () => {
        await signer.cancelAllUnlockWaiters();
        return { ok: true };
    }],

    ['signer_cancelUnlockWaiter', async (params) => {
        await signer.cancelUnlockWaiter(params.id as string);
        return { ok: true };
    }],
]);
