/**
 * Onboarding and NostrConnect session handlers.
 * @module lib/bg/onboarding-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import * as accounts from '../accounts.ts';
import * as storage from '../storage.ts';
import { LocalGraph } from '../graph.ts';
import { isSyncInProgress, stopSync } from '../sync.ts';
import { npubEncode } from '../crypto/bech32.ts';
import { bytesToHex, randomHex } from '../crypto/utils.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../crypto/nip49.ts';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import { generateSecretKey, getPublicKey as ntGetPublicKey } from 'nostr-tools/pure';
import { config, DEFAULT_RELAYS, setLocalGraph, type HandlerFn } from './state.ts';
import { syncActivePubkey } from './vault-handlers.ts';
import { broadcastAccountChanged, refreshBadgesOnAllTabs } from './domain-handlers.ts';
import type { Account } from '../types.ts';

// ── NostrConnect sessions ──

interface NostrConnectSession {
    signerPromise: Promise<BunkerSigner>;
    signer: BunkerSigner | null;
    secretKey: Uint8Array;
    localPubkey: string;
    relays: string[];
    error: Error | null;
    abortController: AbortController;
}
const _nostrConnectSessions = new Map<string, NostrConnectSession>();

// ── Pending onboarding account ──

let _pendingOnboardingAccount: Account | null = null;
let _pendingOnboardingTimer: ReturnType<typeof setTimeout> | null = null;
const ONBOARDING_TTL_MS = 5 * 60 * 1000;

async function setPendingOnboardingAccount(acct: Account | null): Promise<void> {
    _pendingOnboardingAccount = acct;
    if (_pendingOnboardingTimer) { clearTimeout(_pendingOnboardingTimer); _pendingOnboardingTimer = null; }
    if (acct) {
        await browser.storage.session.set({ _pendingOnboardingAccount: acct });
        _pendingOnboardingTimer = setTimeout(() => setPendingOnboardingAccount(null), ONBOARDING_TTL_MS);
    } else {
        await browser.storage.session.remove('_pendingOnboardingAccount');
    }
}

async function getPendingOnboardingAccount(): Promise<Account | null> {
    if (_pendingOnboardingAccount) return _pendingOnboardingAccount;
    const data = await browser.storage.session.get('_pendingOnboardingAccount');
    return (data as Record<string, Account | null>)._pendingOnboardingAccount || null;
}

export async function checkDuplicateAccount(pubkey: string): Promise<{ upgradeFromReadOnly: string | null }> {
    const localAccts = ((await browser.storage.local.get(['accounts'])) as Record<string, Array<{ pubkey: string; id: string }>>).accounts || [];
    const existing = localAccts.find(a => a.pubkey === pubkey);
    if (existing && await vault.exists() && !vault.isLocked()) {
        const hasEncryptedKey = vault.listAccounts().some(a => a.pubkey === pubkey && !a.readOnly);
        if (hasEncryptedKey) {
            throw new Error('This account is already added with full signing access.');
        }
        return { upgradeFromReadOnly: existing.id };
    }
    return { upgradeFromReadOnly: null };
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['onboarding_validateNsec', async (params) => {
        const acct = await accounts.importNsec(params.input as string);
        const { privkey, mnemonic, ...safeAcct } = acct;
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly
        };
    }],

    ['onboarding_validateNcryptsec', async (params) => {
        const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
        const acct = await accounts.importNsec(privkeyHex, params.name as string);
        const { privkey: _pk, mnemonic: _mn, ...safeAcct } = acct;
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly
        };
    }],

    ['onboarding_validateMnemonic', async (params) => {
        const mnemonic = (params.mnemonic as string).trim().toLowerCase().replace(/\s+/g, ' ');
        let hasSeed = false;
        if (await vault.exists() && !vault.isLocked()) {
            try {
                const payload = vault.getDecryptedPayload();
                hasSeed = payload.accounts.some(a => a.type === 'generated' && a.mnemonic);
            } catch { /* ignore */ }
        }
        const acct = hasSeed
            ? await accounts.importFromMnemonicDerived(mnemonic)
            : await accounts.createFromMnemonic(mnemonic, 'Imported');
        const { privkey, mnemonic: _mn, ...safeAcct } = acct;
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly,
            importedAsMain: !hasSeed,
        };
    }],

    ['onboarding_validateNpub', async (params) => {
        const acct = accounts.importNpub(params.input as string);
        return { account: acct, pubkey: acct.pubkey };
    }],

    ['onboarding_connectNip46', async (params) => {
        const acct = accounts.connectNip46(params.bunkerUrl as string);
        await setPendingOnboardingAccount(acct);
        const { nip46Config: _n46, privkey: _pk, mnemonic: _mn, ...safeNip46 } = acct;
        return { account: safeNip46 };
    }],

    ['onboarding_initNostrConnect', async () => {
        // Clean up existing sessions
        for (const [oldId, oldSession] of _nostrConnectSessions) {
            oldSession.abortController.abort();
            if (oldSession.signer) oldSession.signer.close().catch(() => {});
            _nostrConnectSessions.delete(oldId);
        }

        const NIP46_RELAYS = ['wss://relay.nsec.app', ...DEFAULT_RELAYS];
        const connectSecret = randomHex(16);
        const ncSecretKey = generateSecretKey();
        const ncLocalPubkey = ntGetPublicKey(ncSecretKey);

        const nostrconnectUri = createNostrConnectURI({
            clientPubkey: ncLocalPubkey,
            relays: NIP46_RELAYS,
            secret: connectSecret,
            name: 'Nostr WoT',
            url: 'https://nostr-wot.com',
            image: 'https://nostr-wot.com/icon-512.png'
        });

        const abortController = new AbortController();
        const sessionId = randomHex(8);
        const session: NostrConnectSession = {
            signerPromise: null!,
            signer: null,
            secretKey: ncSecretKey,
            localPubkey: ncLocalPubkey,
            relays: NIP46_RELAYS,
            error: null,
            abortController,
        };

        session.signerPromise = BunkerSigner.fromURI(
            ncSecretKey,
            nostrconnectUri,
            { onauth(url: string) {
                if (!url.startsWith('https://')) {
                    console.warn('[NIP-46] rejected non-HTTPS auth_url:', url);
                    return;
                }
                browser.tabs.create({ url });
            } },
            abortController.signal
        );
        session.signerPromise
            .then(signer => { session.signer = signer; })
            .catch(err => { session.error = err; });

        _nostrConnectSessions.set(sessionId, session);
        return { nostrconnectUri, sessionId };
    }],

    ['onboarding_pollNostrConnect', async (params) => {
        const session = _nostrConnectSessions.get(params.sessionId as string);
        if (!session) return { expired: true };

        if (session.signer) {
            const signerPk = session.signer.bp.pubkey;
            const primaryRelay = session.relays[0];
            const localPrivkeyHex = bytesToHex(session.secretKey);
            const acct = accounts.connectNostrConnect(
                signerPk, primaryRelay,
                localPrivkeyHex, session.localPubkey
            );
            _nostrConnectSessions.delete(params.sessionId as string);
            await setPendingOnboardingAccount(acct);
            const { nip46Config: _n46, privkey: _pk, mnemonic: _mn, ...safeNc } = acct;
            return { connected: true, account: safeNc };
        }
        if (session.error) {
            _nostrConnectSessions.delete(params.sessionId as string);
            return { expired: true };
        }
        return { connected: false };
    }],

    ['onboarding_cancelNostrConnect', async (params) => {
        const session2 = _nostrConnectSessions.get(params.sessionId as string);
        if (session2) {
            session2.abortController.abort();
            if (session2.signer) session2.signer.close().catch(() => {});
            _nostrConnectSessions.delete(params.sessionId as string);
        }
        return { ok: true };
    }],

    ['onboarding_generateAccount', async () => {
        const { account: acct, mnemonic } = await accounts.generateNewAccount();
        const { privkey, ...safeAcct } = acct;
        await setPendingOnboardingAccount(acct);
        return { account: safeAcct, mnemonic };
    }],

    ['onboarding_checkExistingSeed', async () => {
        if (vault.isLocked()) return { hasSeed: false };
        try {
            const payload = vault.getDecryptedPayload();
            const generated = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
            return { hasSeed: !!generated };
        } catch {
            return { hasSeed: false };
        }
    }],

    ['onboarding_generateSubAccount', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const payload = vault.getDecryptedPayload();
        const seedAccount = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
        if (!seedAccount || !seedAccount.mnemonic) {
            throw new Error('No existing seed account found');
        }
        const maxIndex = payload.accounts
            .filter(a => a.type === 'generated' && a.mnemonic === seedAccount.mnemonic)
            .reduce((max, a) => Math.max(max, a.derivationIndex ?? 0), 0);
        const nextIndex = maxIndex + 1;
        const subAcct = await accounts.createFromMnemonicAtIndex(
            seedAccount.mnemonic,
            nextIndex,
            (params.name as string) || undefined
        );
        const { privkey: _pk, ...safeSubAcct } = subAcct;
        await setPendingOnboardingAccount(subAcct);
        return { account: safeSubAcct, derivationIndex: nextIndex };
    }],

    ['onboarding_exportNcryptsec', async (params) => {
        const pendingAcctEnc = await getPendingOnboardingAccount();
        if (!pendingAcctEnc?.privkey) throw new Error('No pending account');
        const ncryptsec = await ncryptsecEncode(pendingAcctEnc.privkey, params.password as string);
        return ncryptsec;
    }],

    ['onboarding_saveReadOnly', async (params) => {
        const acctId = (params.account as Record<string, string>).id;
        const pubkey = (params.account as Record<string, string>).pubkey;
        const acctType = (params.account as Record<string, string>).type || 'npub';
        if (pubkey) {
            config.myPubkey = pubkey;
            await browser.storage.sync.set({ myPubkey: pubkey });
        }
        const localAccts = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
        const accts = localAccts.accounts || [];
        if (!accts.some(a => a.id === acctId)) {
            accts.push({
                id: acctId,
                name: (params.account as Record<string, string>).name || 'Account',
                pubkey,
                type: acctType,
                readOnly: acctType !== 'nip46'
            });
        }
        await browser.storage.local.set({ accounts: accts, activeAccountId: acctId });
        await storage.switchDatabase(acctId);
        setLocalGraph(new LocalGraph());
        return { ok: true };
    }],

    ['onboarding_createVault', async (params) => {
        const pendingAcct = await getPendingOnboardingAccount();
        const fullAccount = pendingAcct && pendingAcct.id === (params.account as Record<string, string>).id
            ? pendingAcct
            : params.account as Account;
        if (!fullAccount.privkey && fullAccount.type !== 'npub' && fullAccount.type !== 'nip46') {
            throw new Error('Cannot create vault: private key was lost. Please re-import your nsec.');
        }
        await setPendingOnboardingAccount(null);

        const payload = {
            accounts: [fullAccount],
            activeAccountId: fullAccount.id
        };
        await vault.create(params.password as string, payload);
        if (params.autoLockMinutes !== undefined) {
            vault.setAutoLockTimeout((params.autoLockMinutes as number) * 60 * 1000);
            await browser.storage.local.set({ autoLockMs: (params.autoLockMinutes as number) * 60 * 1000 });
        }
        await syncActivePubkey();
        const vaultAcctId = fullAccount.id;
        const localAccts = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
        let accts = localAccts.accounts || [];
        if (params.upgradeFromReadOnly) {
            accts = accts.filter(a => a.id !== params.upgradeFromReadOnly);
        }
        if (!accts.some(a => a.id === vaultAcctId)) {
            accts.push({
                id: vaultAcctId,
                name: fullAccount.name || 'Account',
                pubkey: fullAccount.pubkey,
                type: fullAccount.type || 'generated',
                readOnly: !fullAccount.privkey && fullAccount.type !== 'nip46'
            });
        } else {
            const idx = accts.findIndex(a => a.id === vaultAcctId);
            if (idx !== -1) accts[idx].readOnly = !fullAccount.privkey && fullAccount.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: accts, activeAccountId: vaultAcctId });
        await storage.switchDatabase((params.upgradeFromReadOnly as string) || vaultAcctId);
        setLocalGraph(new LocalGraph());
        return { ok: true };
    }],

    ['onboarding_addToVault', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');

        const pendingAcctAdd = await getPendingOnboardingAccount();
        const fullAccountAdd = pendingAcctAdd && pendingAcctAdd.id === (params.account as Record<string, string>).id
            ? pendingAcctAdd
            : params.account as Account;
        if (!fullAccountAdd.privkey && fullAccountAdd.type !== 'npub' && fullAccountAdd.type !== 'nip46') {
            throw new Error('Cannot add account: private key was lost. Please re-import.');
        }
        await setPendingOnboardingAccount(null);

        await vault.addAccount(fullAccountAdd);
        await vault.setActiveAccount(fullAccountAdd.id);
        await syncActivePubkey();

        const addVaultLocalData = await browser.storage.local.get(['accounts']) as Record<string, Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>>;
        let addVaultAccts = addVaultLocalData.accounts || [];
        if (params.upgradeFromReadOnly) {
            addVaultAccts = addVaultAccts.filter(a => a.id !== params.upgradeFromReadOnly);
        }
        if (!addVaultAccts.some(a => a.id === fullAccountAdd.id)) {
            addVaultAccts.push({
                id: fullAccountAdd.id,
                name: fullAccountAdd.name || 'Account',
                pubkey: fullAccountAdd.pubkey,
                type: fullAccountAdd.type || 'generated',
                readOnly: !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46'
            });
        } else {
            const idx = addVaultAccts.findIndex(a => a.id === fullAccountAdd.id);
            if (idx !== -1) addVaultAccts[idx].readOnly = !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: addVaultAccts, activeAccountId: fullAccountAdd.id });
        if (isSyncInProgress()) {
            await stopSync();
        }
        await storage.switchDatabase((params.upgradeFromReadOnly as string) || fullAccountAdd.id);
        setLocalGraph(new LocalGraph());
        refreshBadgesOnAllTabs();
        if (fullAccountAdd.pubkey) {
            broadcastAccountChanged(fullAccountAdd.pubkey);
        }
        return { ok: true };
    }],
]);
