/**
 * Wallet and WebLN handlers.
 * @module lib/bg/wallet-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import * as signer from '../signer.ts';
import * as signerPermissions from '../permissions.ts';
import { npubEncode } from '../crypto/bech32.ts';
import { signEvent } from '../crypto/nip01.ts';
import { getWalletProvider, removeWalletProvider, type WalletConfig } from '../wallet/';
import { decodeBolt11 } from '../wallet/bolt11.ts';
import { provisionLnbitsWallet, claimLightningAddress, getLightningAddress, releaseLightningAddress, DEFAULT_LNBITS_URL } from '../wallet/lnbits-provision.ts';
import type { SignedEvent } from '../types.ts';
import type { HandlerFn } from './state.ts';
import { addAllowedDomain } from './domain-handlers.ts';

// ── Shared utilities ──

export async function getConnectedProvider(): Promise<{ provider: ReturnType<typeof getWalletProvider>; acct: NonNullable<ReturnType<typeof vault.getActiveAccountWithWallet>> }> {
    if (vault.isLocked()) throw new Error('Vault is locked');
    const acct = vault.getActiveAccountWithWallet();
    if (!acct?.walletConfig) throw new Error('No wallet configured');
    const provider = getWalletProvider(acct.id, acct.walletConfig);
    if (!provider) throw new Error('Provider not available');
    if (!provider.isConnected()) await provider.connect();
    return { provider, acct };
}

export function createNip98SignFn(acctId: string, endpointUrl: string): (challenge: string) => Promise<SignedEvent> {
    return async (challenge: string): Promise<SignedEvent> => {
        const privkeyBytes = vault.getPrivkey(acctId);
        if (!privkeyBytes) throw new Error('No private key available');
        try {
            return await signEvent({
                kind: 27235,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['challenge', challenge], ['u', endpointUrl], ['method', 'POST']],
                content: '',
            }, privkeyBytes);
        } finally {
            privkeyBytes.fill(0);
        }
    };
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['webln_enable', async (params) => {
        const origin = (params as { origin?: string }).origin;
        if (origin) await addAllowedDomain(origin);
        return true;
    }],

    ['webln_getInfo', async () => {
        const { provider, acct } = await getConnectedProvider();
        const info = await provider.getInfo();
        return {
            node: { alias: info.alias || '', pubkey: acct.pubkey },
            supports: ['lightning'],
            methods: ['getInfo', 'sendPayment', 'makeInvoice', 'getBalance'],
        };
    }],

    ['webln_getBalance', async () => {
        const { provider } = await getConnectedProvider();
        return await provider.getBalance();
    }],

    ['webln_sendPayment', async (params) => {
        const { paymentRequest, origin } = params as { paymentRequest: string; origin: string };
        if (!paymentRequest) throw new Error('Missing paymentRequest');

        const { provider } = await getConnectedProvider();

        // S-17: Decode BOLT11 to extract invoice amount for user display
        let invoiceAmountSats = 0;
        try {
            const decoded = decodeBolt11(paymentRequest);
            if (decoded?.amountSats != null) {
                invoiceAmountSats = decoded.amountSats;
            }
        } catch {
            // Decode failed — fall through with 0 (unknown amount)
        }

        const perm = await signerPermissions.check(origin, 'webln_sendPayment');
        if (perm === 'deny') throw new Error('Permission denied');

        // S-18: Auto-approve if amount is within the stored threshold
        let autoApproved = false;
        if (perm === 'allow' && invoiceAmountSats > 0) {
            const acctId = vault.getActiveAccountId();
            if (acctId) {
                const data = await browser.storage.local.get(`walletThreshold_${acctId}`) as Record<string, number>;
                const threshold = data[`walletThreshold_${acctId}`] || 0;
                if (threshold > 0 && invoiceAmountSats <= threshold) {
                    autoApproved = true;
                }
            }
        }

        if (!autoApproved && perm === 'ask') {
            const decision = await signer.queueRequest({
                type: 'webln_sendPayment',
                origin,
                needsPermission: true,
                walletAmount: invoiceAmountSats,
            });
            if (!decision.allow) throw new Error('Payment denied by user');
            if (decision.remember) {
                await signerPermissions.save(origin, 'webln_sendPayment', null, 'allow');
            }
        }

        return await provider.payInvoice(paymentRequest);
    }],

    ['webln_makeInvoice', async (params) => {
        const { amount, defaultMemo } = params as { amount: number; defaultMemo?: string; origin: string };
        const { provider } = await getConnectedProvider();
        const inv = await provider.makeInvoice(amount, defaultMemo);
        return { paymentRequest: inv.bolt11 };
    }],

    ['wallet_hasConfig', async () => {
        if (vault.isLocked()) return false;
        const acct = vault.getActiveAccountWithWallet();
        return acct?.walletConfig?.type ?? false;
    }],

    ['wallet_getInfo', async () => {
        const { provider } = await getConnectedProvider();
        return await provider.getInfo();
    }],

    ['wallet_getBalance', async () => {
        const { provider } = await getConnectedProvider();
        return await provider.getBalance();
    }],

    ['wallet_connect', async (params) => {
        const { walletConfig } = params as { walletConfig: WalletConfig };
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        await vault.updateAccountWalletConfig(acctId, walletConfig);
        const provider = getWalletProvider(acctId, walletConfig);
        if (provider) {
            await provider.connect();
        }
        return true;
    }],

    ['wallet_disconnect', async () => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        removeWalletProvider(acctId);
        await vault.updateAccountWalletConfig(acctId, null);
        return true;
    }],

    ['wallet_setAutoApproveThreshold', async (params) => {
        const { threshold } = params as { threshold: number };
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        await browser.storage.local.set({ [`walletThreshold_${acctId}`]: threshold });
        return true;
    }],

    ['wallet_getAutoApproveThreshold', async () => {
        const acctId = vault.getActiveAccountId();
        if (!acctId) return 0;
        const data = await browser.storage.local.get(`walletThreshold_${acctId}`) as Record<string, number>;
        return data[`walletThreshold_${acctId}`] || 0;
    }],

    ['wallet_makeInvoice', async (params) => {
        const { amount, memo } = params as { amount: number; memo?: string };
        const { provider } = await getConnectedProvider();
        return await provider.makeInvoice(amount, memo);
    }],

    ['wallet_getTransactions', async (params) => {
        const { limit, offset } = params as { limit?: number; offset?: number };
        const { provider } = await getConnectedProvider();
        return await provider.listTransactions(limit ?? 10, offset ?? 0);
    }],

    ['wallet_payInvoice', async (params) => {
        const { bolt11 } = params as { bolt11: string };
        const { provider } = await getConnectedProvider();
        return await provider.payInvoice(bolt11);
    }],

    ['wallet_provision', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct) throw new Error('No active account');

        const url = (params.instanceUrl as string)?.trim() || DEFAULT_LNBITS_URL;
        const npub = npubEncode(acct.pubkey);
        const walletName = `WoT:${npub.slice(0, 16)}`;

        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/provision`);
        const { adminKey, nwcUri } = await provisionLnbitsWallet(url, walletName, signFn);

        const walletConfig: WalletConfig = { type: 'lnbits', instanceUrl: url, adminKey, nwcUri };
        await vault.updateAccountWalletConfig(acctId, walletConfig);
        const provider = getWalletProvider(acctId, walletConfig);
        if (provider) await provider.connect();
        return true;
    }],

    ['wallet_getNwcUri', async () => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') return null;
        return acct.walletConfig.nwcUri ?? null;
    }],

    ['wallet_claimLightningAddress', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            throw new Error('No LNbits wallet configured');
        }
        const url = acct.walletConfig.instanceUrl;
        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/claim-username`);
        return await claimLightningAddress(url, params.username as string, signFn);
    }],

    ['wallet_getLightningAddress', async () => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            return { address: null };
        }
        const address = await getLightningAddress(acct.walletConfig.instanceUrl, acct.pubkey);
        return { address };
    }],

    ['wallet_releaseLightningAddress', async () => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const acctId = vault.getActiveAccountId();
        if (!acctId) throw new Error('No active account');
        const acct = vault.getActiveAccountWithWallet();
        if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') {
            throw new Error('No LNbits wallet configured');
        }
        const url = acct.walletConfig.instanceUrl;
        const signFn = createNip98SignFn(acctId, `${url.replace(/\/+$/, '')}/api/release-username`);
        await releaseLightningAddress(url, signFn);
        return { ok: true };
    }],
]);
