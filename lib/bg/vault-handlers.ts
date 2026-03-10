/**
 * Vault lifecycle and account-switching handlers.
 * @module lib/bg/vault-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import * as signer from '../signer.ts';
import * as signerPermissions from '../permissions.ts';
import * as storage from '../storage.ts';
import * as accounts from '../accounts.ts';
import { isSyncInProgress, stopSync } from '../sync.ts';
import { nsecEncode } from '../crypto/bech32.ts';
import { bytesToHex } from '../crypto/utils.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../crypto/nip49.ts';
import { clearWalletProviders } from '../wallet/';
import { config, resetLocalGraph, type HandlerFn, type LocalAccountEntry } from './state.ts';
import { broadcastAccountChanged, refreshBadgesOnAllTabs } from './domain-handlers.ts';
import type { Account, VaultPayload } from '../types.ts';

// ── Sync active pubkey to WoT config ──

export async function syncActivePubkey(): Promise<void> {
    const pubkey = vault.getActivePubkey();
    if (pubkey) {
        config.myPubkey = pubkey;
        await browser.storage.sync.set({ myPubkey: pubkey });
    } else {
        config.myPubkey = '';
        await browser.storage.sync.remove('myPubkey');
    }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['vault_unlock', async (params) => {
        const unlockResult = await vault.unlock(params.password as string);
        if (unlockResult) {
            const unlockData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
            if (unlockData.activeAccountId) {
                try {
                    await vault.setActiveAccount(unlockData.activeAccountId);
                } catch {
                    vault.clearActiveAccount();
                }
            }
            await signer.onVaultUnlocked();
        }
        return unlockResult;
    }],

    ['vault_lock', async () => {
        vault.lock();
        clearWalletProviders();
        return { ok: true };
    }],

    ['vault_isLocked', async () => vault.isLocked()],

    ['vault_exists', async () => vault.exists()],

    ['vault_setAutoLock', async (params) => {
        const prevMs = ((await browser.storage.local.get(['autoLockMs'])) as Record<string, number>).autoLockMs ?? 900000;
        const wasNever = prevMs === 0;
        const willBeNever = params.ms === 0;

        if (wasNever !== willBeNever) {
            const payload = vault.getDecryptedPayload();
            if (wasNever) {
                if (!params.password || (params.password as string).length < 8) {
                    throw new Error('Password required (min 8 characters)');
                }
                await vault.create(params.password as string, payload!);
            } else {
                if (!params.currentPassword) {
                    throw new Error('Current password required');
                }
                const ok = await vault.unlock(params.currentPassword as string);
                if (!ok) throw new Error('Current password is incorrect');
                await vault.create('', payload!);
            }
        }

        vault.setAutoLockTimeout(params.ms as number);
        await browser.storage.local.set({ autoLockMs: params.ms });
        return { result: true };
    }],

    ['vault_getAutoLock', async () => {
        const data = await browser.storage.local.get(['autoLockMs']) as Record<string, number>;
        return data.autoLockMs ?? 900000;
    }],

    ['vault_create', async (params) => {
        await vault.create(params.password as string, params.payload as VaultPayload);
        await syncActivePubkey();
        return { ok: true };
    }],

    ['vault_listAccounts', async () => vault.listAccounts()],

    ['vault_addAccount', async (params) => {
        await vault.addAccount(params.account as Account);
        const addLocalData = await browser.storage.local.get(['accounts']) as Record<string, LocalAccountEntry[]>;
        const addAccts = addLocalData.accounts || [];
        if (!addAccts.some(a => a.id === (params.account as Account).id)) {
            addAccts.push({
                id: (params.account as Account).id,
                name: (params.account as Account).name || 'Account',
                pubkey: (params.account as Account).pubkey,
                type: (params.account as Account).type || 'generated',
                readOnly: (params.account as Account).readOnly
            });
            await browser.storage.local.set({ accounts: addAccts });
        }
        return { ok: true };
    }],

    ['vault_removeAccount', async (params) => {
        const removedId = params.accountId as string;
        await vault.removeAccount(removedId);
        await signerPermissions.clearForAccount(removedId);
        await syncActivePubkey();
        const rmLocalData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
        const rmAccts = ((rmLocalData.accounts as Array<{ id: string }>) || []).filter(a => a.id !== removedId);
        const updates: Record<string, unknown> = { accounts: rmAccts };
        if (rmLocalData.activeAccountId === removedId) {
            updates.activeAccountId = vault.getActiveAccountId() || (rmAccts[0] as { id: string })?.id || null;
        }
        await browser.storage.local.set(updates);
        const newActiveId = (updates.activeAccountId ?? rmLocalData.activeAccountId) as string;
        if (newActiveId) {
            await storage.switchDatabase(newActiveId);
        }
        resetLocalGraph();
        return { ok: true };
    }],

    ['switchAccount', async (params) => {
        if (isSyncInProgress()) {
            await stopSync();
        }
        const switchId = params.accountId as string;
        const oldData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const oldAccountId = oldData.activeAccountId;
        try {
            await vault.setActiveAccount(switchId);
        } catch {
            vault.clearActiveAccount();
        }
        const switchData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; pubkey: string }>>;
        const switchAcct = (switchData.accounts || []).find(a => a.id === switchId);
        const switchPubkey = switchAcct?.pubkey || vault.getActivePubkey();
        if (switchPubkey) {
            config.myPubkey = switchPubkey;
            await browser.storage.sync.set({ myPubkey: switchPubkey });
        }
        await browser.storage.local.set({ activeAccountId: switchId });
        await storage.switchDatabase(switchId);
        resetLocalGraph();
        refreshBadgesOnAllTabs();
        if (oldAccountId && oldAccountId !== switchId) {
            await signer.rejectPendingForAccount(oldAccountId);
        }
        if (switchPubkey) {
            broadcastAccountChanged(switchPubkey);
        }
        return { ok: true };
    }],

    ['vault_setActiveAccount', async (params) => {
        if (isSyncInProgress()) {
            await stopSync();
        }
        await vault.setActiveAccount(params.accountId as string);
        await syncActivePubkey();
        await storage.switchDatabase(params.accountId as string);
        resetLocalGraph();
        return { ok: true };
    }],

    ['vault_getActivePubkey', async () => vault.getActivePubkey()],

    ['vault_exportNsec', async () => {
        const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const privkeyBytes = vault.getPrivkey(exportData.activeAccountId);
        if (!privkeyBytes) throw new Error('No private key available');
        const nsec = nsecEncode(bytesToHex(privkeyBytes));
        privkeyBytes.fill(0);
        return nsec;
    }],

    ['vault_exportNcryptsec', async (params) => {
        const exportData = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const privkeyBytes = vault.getPrivkey(exportData.activeAccountId);
        if (!privkeyBytes) throw new Error('No private key available');
        try {
            return await ncryptsecEncode(bytesToHex(privkeyBytes), params.password as string);
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['vault_exportSeed', async () => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const payload = vault.getDecryptedPayload();
        const activeId = (await browser.storage.local.get(['activeAccountId']) as Record<string, string>).activeAccountId;
        const activeAcct = payload.accounts.find(a => a.id === activeId);
        if (!activeAcct || activeAcct.type !== 'generated' || !activeAcct.mnemonic) {
            throw new Error('Active account has no seed phrase');
        }
        return { mnemonic: activeAcct.mnemonic, wordCount: activeAcct.mnemonic.split(' ').length };
    }],

    ['vault_importNcryptsec', async (params) => {
        const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
        const acct = await accounts.importNsec(privkeyHex, params.name as string);
        const { privkey, mnemonic, ...safeAcct } = acct;
        return { account: safeAcct, pubkey: acct.pubkey };
    }],

    ['vault_changePassword', async (params) => {
        const unlocked = await vault.unlock(params.currentPassword as string);
        if (!unlocked) throw new Error('Current password is incorrect');
        await vault.reEncrypt(params.newPassword as string);
        return { ok: true };
    }],

    ['vault_getActiveAccountType', async () => {
        const typeData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
        const typeAccts = (typeData.accounts as LocalAccountEntry[]) || [];
        const typeActive = typeAccts.find(a => a.id === typeData.activeAccountId);
        if (typeActive) {
            return { type: typeActive.type || 'npub', readOnly: typeActive.readOnly !== false };
        }
        return null;
    }],

    ['listDatabases', async () => storage.listAllDatabases()],

    ['getDatabaseStats', async (params) => storage.getDatabaseStats(params.accountId as string)],

    ['deleteAccountDatabase', async (params) => {
        await storage.deleteDatabase(params.accountId as string);
        resetLocalGraph();
        return { ok: true };
    }],

    ['deleteAllDatabases', async () => {
        const dbs = await storage.listAllDatabases();
        for (const d of dbs) {
            await storage.deleteDatabase((d as Record<string, string>).accountId);
        }
        resetLocalGraph();
        return { ok: true };
    }],
]);
