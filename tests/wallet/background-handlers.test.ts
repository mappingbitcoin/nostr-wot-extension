/**
 * Wallet/WebLN Background Handler Tests
 *
 * Tests the wallet and WebLN handler logic from background.ts (lines 1358-1532).
 * Following the pattern from tests/communication.test.ts, handler logic is
 * replicated as pure functions to avoid importing the tightly-coupled background.ts.
 *
 * Covers:
 *   - WebLN handlers (webln_enable, webln_getInfo, webln_getBalance, webln_sendPayment, webln_makeInvoice)
 *   - Wallet management handlers (wallet_hasConfig, wallet_getInfo, wallet_getBalance,
 *     wallet_connect, wallet_disconnect, wallet_setAutoApproveThreshold,
 *     wallet_getAutoApproveThreshold, wallet_makeInvoice)
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/wallet/background-handlers.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from '../helpers/browser-mock.ts';
import * as vault from '../../lib/vault.ts';
import * as permissions from '../../lib/permissions.ts';
import {
  getWalletProvider, setWalletProvider, removeWalletProvider,
  clearWalletProviders,
} from '../../lib/wallet/index.ts';
import type { WalletProvider, WalletProviderInfo, WalletConfig } from '../../lib/wallet/types.ts';
import type { VaultPayload } from '../../lib/types.ts';
import { npubEncode } from '../../lib/crypto/bech32.ts';

// ── Test Constants ──

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';

const TEST_WALLET_CONFIG: WalletConfig = {
  type: 'lnbits',
  instanceUrl: 'https://legend.lnbits.com',
  adminKey: 'testapikey123',
};

// ── Mock Wallet Provider ──

function createMockProvider(overrides?: Partial<WalletProvider>): WalletProvider {
  let connected = false;
  return {
    type: 'lnbits',
    async getInfo(): Promise<WalletProviderInfo> {
      return { alias: 'TestWallet', methods: ['payInvoice', 'makeInvoice'] };
    },
    async getBalance() { return { balance: 50000 }; },
    async payInvoice(_bolt11: string) { return { preimage: 'abc123' }; },
    async makeInvoice(_amount: number, _memo?: string) {
      return { bolt11: 'lnbc1...', paymentHash: 'hash123' };
    },
    async connect() { connected = true; },
    disconnect() { connected = false; },
    isConnected() { return connected; },
    ...overrides,
  };
}

// ── Vault Payload Helpers ──

function makePayloadWithWallet(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1', name: 'Test', type: 'nsec',
      pubkey: TEST_PUBKEY_HEX, privkey: TEST_PRIVKEY_HEX,
      mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1000000,
      walletConfig: TEST_WALLET_CONFIG,
    }],
    activeAccountId: 'acct1',
  };
}

function makePayloadNoWallet(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1', name: 'Test', type: 'nsec',
      pubkey: TEST_PUBKEY_HEX, privkey: TEST_PRIVKEY_HEX,
      mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1000000,
    }],
    activeAccountId: 'acct1',
  };
}

// ── Handler Simulations ──
//
// These replicate the exact logic from background.ts handler cases.
// By extracting them as pure functions we test the same validation
// and routing logic without importing the tightly-coupled background module.

type HandlerResult = { result: unknown; error: string | null };

function handleWeblnEnable(): HandlerResult {
  // Always succeed — vault/wallet checks happen in individual methods.
  return { result: true, error: null };
}

async function handleWeblnGetInfo(): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Wallet provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    const info = await provider.getInfo();
    return { result: { node: { alias: info.alias || '', pubkey: acct.pubkey } }, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function handleWeblnGetBalance(): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Wallet provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    const bal = await provider.getBalance();
    return { result: bal, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function handleWeblnSendPayment(params: {
  paymentRequest?: string;
  origin?: string;
}): Promise<HandlerResult> {
  const { paymentRequest, origin } = params;
  if (!paymentRequest) return { result: null, error: 'Missing paymentRequest' };
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Wallet provider not available' };

  const perm = await permissions.check(origin || '', 'webln_sendPayment');
  if (perm === 'deny') return { result: null, error: 'Permission denied' };
  // 'ask' would queue for approval — skip in tests to avoid hanging

  try {
    if (!provider.isConnected()) await provider.connect();
    const result = await provider.payInvoice(paymentRequest);
    return { result, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function handleWeblnMakeInvoice(params: {
  amount: number;
  defaultMemo?: string;
}): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Wallet provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    const inv = await provider.makeInvoice(params.amount, params.defaultMemo);
    return { result: { paymentRequest: inv.bolt11 }, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

function handleWalletHasConfig(): HandlerResult {
  if (vault.isLocked()) return { result: false, error: null };
  const acct = vault.getActiveAccountWithWallet();
  // Return the provider type string (truthy) or false
  return { result: acct?.walletConfig?.type ?? false, error: null };
}

async function handleWalletGetInfo(): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    return { result: await provider.getInfo(), error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function handleWalletGetBalance(): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    return { result: await provider.getBalance(), error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

async function handleWalletConnect(params: {
  walletConfig: WalletConfig;
}): Promise<HandlerResult> {
  const { walletConfig } = params;
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acctId = vault.getActiveAccountId();
  if (!acctId) return { result: null, error: 'No active account' };
  await vault.updateAccountWalletConfig(acctId, walletConfig);
  const provider = getWalletProvider(acctId, walletConfig);
  if (provider) {
    await provider.connect();
  }
  return { result: true, error: null };
}

async function handleWalletDisconnect(): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acctId = vault.getActiveAccountId();
  if (!acctId) return { result: null, error: 'No active account' };
  removeWalletProvider(acctId);
  await vault.updateAccountWalletConfig(acctId, null);
  return { result: true, error: null };
}

async function handleWalletSetAutoApproveThreshold(params: {
  threshold: number;
}): Promise<HandlerResult> {
  const { threshold } = params;
  const acctId = vault.getActiveAccountId();
  if (!acctId) return { result: null, error: 'No active account' };
  const { default: browser } = await import('../helpers/browser-mock.ts');
  await browser.storage.local.set({ [`walletThreshold_${acctId}`]: threshold });
  return { result: true, error: null };
}

async function handleWalletGetAutoApproveThreshold(): Promise<HandlerResult> {
  const acctId = vault.getActiveAccountId();
  if (!acctId) return { result: 0, error: null };
  const { default: browser } = await import('../helpers/browser-mock.ts');
  const data = await browser.storage.local.get(`walletThreshold_${acctId}`) as Record<string, number>;
  return { result: data[`walletThreshold_${acctId}`] || 0, error: null };
}

async function handleWalletMakeInvoice(params: {
  amount: number;
  memo?: string;
}): Promise<HandlerResult> {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig) return { result: null, error: 'No wallet configured' };
  const provider = getWalletProvider(acct.id, acct.walletConfig);
  if (!provider) return { result: null, error: 'Provider not available' };
  try {
    if (!provider.isConnected()) await provider.connect();
    const inv = await provider.makeInvoice(params.amount, params.memo);
    return { result: inv, error: null };
  } catch (e) {
    return { result: null, error: (e as Error).message };
  }
}

function handleWalletGetNwcUri(): HandlerResult {
  if (vault.isLocked()) return { result: null, error: 'Vault is locked' };
  const acct = vault.getActiveAccountWithWallet();
  if (!acct?.walletConfig || acct.walletConfig.type !== 'lnbits') return { result: null, error: null };
  return { result: (acct.walletConfig as { nwcUri?: string }).nwcUri ?? null, error: null };
}

async function handleWalletProvision(params: {
  instanceUrl?: string;
}): Promise<unknown> {
  if (vault.isLocked()) throw new Error('Vault is locked');
  const acctId = vault.getActiveAccountId();
  if (!acctId) throw new Error('No active account');
  const acct = vault.getActiveAccountWithWallet();
  if (!acct) throw new Error('No active account');

  const { provisionLnbitsWallet, DEFAULT_LNBITS_URL } = await import('../../lib/wallet/lnbits-provision.ts');
  const url = params.instanceUrl?.trim() || DEFAULT_LNBITS_URL;
  const npub = npubEncode(acct.pubkey);
  const walletName = `WoT:${npub.slice(0, 16)}`;

  // Mock signFn — returns a fake signed event (real handler uses vault.getPrivkey + signEvent)
  const signFn = async (challenge: string) => ({
    id: 'test-event-id',
    pubkey: acct.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235 as const,
    tags: [['challenge', challenge], ['u', url]],
    content: '',
    sig: 'test-sig',
  });

  // Mock fetch — returns challenge on GET, provision response on POST
  const mockFetch = async (_url: string, init?: RequestInit) => {
    if (!init?.method || init.method === 'GET') {
      return new Response(JSON.stringify({ challenge: 'test-challenge-hex' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      id: 'prov-wallet-id', adminkey: 'prov-admin-key', inkey: 'prov-inkey',
      name: 'WoT Wallet', balance_msat: 0, user: 'prov-user',
      nwcUri: 'nostr+walletconnect://test-pubkey?relay=wss://relay.test&secret=test-secret',
    }), { status: 201 });
  };

  const { adminKey, nwcUri } = await provisionLnbitsWallet(url, walletName, signFn, mockFetch as typeof fetch);

  const walletConfig = { type: 'lnbits' as const, instanceUrl: url, adminKey, nwcUri };
  await vault.updateAccountWalletConfig(acctId, walletConfig);
  return true;
}

// ═══════════════════════════════════════════════════════
// WebLN Handlers (from web pages, non-privileged)
// ═══════════════════════════════════════════════════════

describe('wallet handlers: webln_enable', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
  });

  it('returns true when vault unlocked and wallet configured', () => {
    const r = handleWeblnEnable();
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);
  });

  it('returns true even when vault is locked', () => {
    vault.lock();
    const r = handleWeblnEnable();
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);
  });

  it('returns true even when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = handleWeblnEnable();
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);
  });
});

describe('wallet handlers: webln_getInfo', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns node info with alias and pubkey on success', async () => {
    const r = await handleWeblnGetInfo();
    assert.deepStrictEqual(r.result, {
      node: { alias: 'TestWallet', pubkey: TEST_PUBKEY_HEX },
    });
    assert.strictEqual(r.error, null);
  });

  it('auto-connects provider if not connected', async () => {
    let connectCalled = false;
    setWalletProvider('acct1', createMockProvider({
      async connect() { connectCalled = true; },
      isConnected() { return false; },
    }));
    await handleWeblnGetInfo();
    assert.strictEqual(connectCalled, true);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWeblnGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWeblnGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async getInfo() { throw new Error('Connection refused'); },
      isConnected() { return true; },
    }));
    const r = await handleWeblnGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Connection refused');
  });
});

describe('wallet handlers: webln_getBalance', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns balance on success', async () => {
    const r = await handleWeblnGetBalance();
    assert.deepStrictEqual(r.result, { balance: 50000 });
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWeblnGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWeblnGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async getBalance() { throw new Error('Timeout'); },
      isConnected() { return true; },
    }));
    const r = await handleWeblnGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Timeout');
  });
});

describe('wallet handlers: webln_sendPayment', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
    await permissions.save('example.com', 'webln_sendPayment', null, 'allow');
  });

  it('returns preimage on success', async () => {
    const r = await handleWeblnSendPayment({
      paymentRequest: 'lnbc1...', origin: 'example.com',
    });
    assert.deepStrictEqual(r.result, { preimage: 'abc123' });
    assert.strictEqual(r.error, null);
  });

  it('returns error when paymentRequest is missing', async () => {
    const r = await handleWeblnSendPayment({ origin: 'example.com' });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Missing paymentRequest');
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWeblnSendPayment({
      paymentRequest: 'lnbc1...', origin: 'example.com',
    });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWeblnSendPayment({
      paymentRequest: 'lnbc1...', origin: 'example.com',
    });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when permission is denied', async () => {
    await permissions.save('blocked.com', 'webln_sendPayment', null, 'deny');
    const r = await handleWeblnSendPayment({
      paymentRequest: 'lnbc1...', origin: 'blocked.com',
    });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Permission denied');
  });

  it('returns error when provider throws on payInvoice', async () => {
    setWalletProvider('acct1', createMockProvider({
      async payInvoice() { throw new Error('Insufficient balance'); },
      isConnected() { return true; },
    }));
    const r = await handleWeblnSendPayment({
      paymentRequest: 'lnbc1...', origin: 'example.com',
    });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Insufficient balance');
  });
});

describe('wallet handlers: webln_makeInvoice', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns paymentRequest on success', async () => {
    const r = await handleWeblnMakeInvoice({ amount: 1000 });
    assert.deepStrictEqual(r.result, { paymentRequest: 'lnbc1...' });
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWeblnMakeInvoice({ amount: 1000 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWeblnMakeInvoice({ amount: 1000 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async makeInvoice() { throw new Error('Invoice creation failed'); },
      isConnected() { return true; },
    }));
    const r = await handleWeblnMakeInvoice({ amount: 1000 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Invoice creation failed');
  });
});

// ═══════════════════════════════════════════════════════
// Wallet Management Handlers (privileged, from extension UI)
// ═══════════════════════════════════════════════════════

describe('wallet handlers: wallet_hasConfig', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
  });

  it('returns provider type when wallet is configured', async () => {
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    const r = handleWalletHasConfig();
    assert.strictEqual(r.result, 'lnbits');
    assert.strictEqual(r.error, null);
  });

  it('returns false when vault is locked (no error)', () => {
    const r = handleWalletHasConfig();
    assert.strictEqual(r.result, false);
    assert.strictEqual(r.error, null);
  });

  it('returns false when no wallet configured', async () => {
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = handleWalletHasConfig();
    assert.strictEqual(r.result, false);
    assert.strictEqual(r.error, null);
  });
});

describe('wallet handlers: wallet_getInfo', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns provider info on success', async () => {
    const r = await handleWalletGetInfo();
    assert.deepStrictEqual(r.result, {
      alias: 'TestWallet', methods: ['payInvoice', 'makeInvoice'],
    });
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWalletGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWalletGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async getInfo() { throw new Error('Network error'); },
      isConnected() { return true; },
    }));
    const r = await handleWalletGetInfo();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Network error');
  });
});

describe('wallet handlers: wallet_getBalance', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns balance on success', async () => {
    const r = await handleWalletGetBalance();
    assert.deepStrictEqual(r.result, { balance: 50000 });
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWalletGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWalletGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async getBalance() { throw new Error('Server error'); },
      isConnected() { return true; },
    }));
    const r = await handleWalletGetBalance();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Server error');
  });
});

describe('wallet handlers: wallet_connect', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
  });

  it('saves config and connects provider on success', async () => {
    // Pre-set a mock provider so getWalletProvider returns it instead
    // of creating a real LnbitsProvider that tries HTTP fetch
    const mockProvider = createMockProvider();
    setWalletProvider('acct1', mockProvider);

    const newConfig: WalletConfig = {
      type: 'lnbits', instanceUrl: 'https://lnbits.example.com', adminKey: 'key123',
    };
    const r = await handleWalletConnect({ walletConfig: newConfig });
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);

    // Verify walletConfig was persisted
    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct?.walletConfig);
    assert.strictEqual(acct.walletConfig.type, 'lnbits');

    // Verify provider was connected
    assert.strictEqual(mockProvider.isConnected(), true);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWalletConnect({ walletConfig: TEST_WALLET_CONFIG });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no active account', async () => {
    // Clear the active account
    vault.clearActiveAccount();
    const r = await handleWalletConnect({ walletConfig: TEST_WALLET_CONFIG });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No active account');
  });
});

describe('wallet handlers: wallet_disconnect', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('removes provider and clears config on success', async () => {
    const r = await handleWalletDisconnect();
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);

    // Verify walletConfig was cleared
    const acct = vault.getActiveAccountWithWallet();
    assert.strictEqual(acct?.walletConfig, undefined);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWalletDisconnect();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no active account', async () => {
    vault.clearActiveAccount();
    const r = await handleWalletDisconnect();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No active account');
  });
});

describe('wallet handlers: wallet_setAutoApproveThreshold', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
  });

  it('saves threshold to storage on success', async () => {
    const r = await handleWalletSetAutoApproveThreshold({ threshold: 1000 });
    assert.strictEqual(r.result, true);
    assert.strictEqual(r.error, null);

    // Verify it was stored
    const { default: browser } = await import('../helpers/browser-mock.ts');
    const data = await browser.storage.local.get('walletThreshold_acct1');
    assert.strictEqual(data['walletThreshold_acct1'], 1000);
  });

  it('returns error when no active account', async () => {
    vault.clearActiveAccount();
    const r = await handleWalletSetAutoApproveThreshold({ threshold: 500 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No active account');
  });
});

describe('wallet handlers: wallet_getAutoApproveThreshold', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
  });

  it('returns stored threshold value', async () => {
    const { default: browser } = await import('../helpers/browser-mock.ts');
    await browser.storage.local.set({ walletThreshold_acct1: 2500 });

    const r = await handleWalletGetAutoApproveThreshold();
    assert.strictEqual(r.result, 2500);
    assert.strictEqual(r.error, null);
  });

  it('returns 0 when no threshold stored', async () => {
    const r = await handleWalletGetAutoApproveThreshold();
    assert.strictEqual(r.result, 0);
    assert.strictEqual(r.error, null);
  });

  it('returns 0 when no active account', async () => {
    vault.clearActiveAccount();
    const r = await handleWalletGetAutoApproveThreshold();
    assert.strictEqual(r.result, 0);
    assert.strictEqual(r.error, null);
  });
});

describe('wallet handlers: wallet_makeInvoice', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
    setWalletProvider('acct1', createMockProvider());
  });

  it('returns full invoice object on success', async () => {
    const r = await handleWalletMakeInvoice({ amount: 5000, memo: 'test payment' });
    assert.deepStrictEqual(r.result, { bolt11: 'lnbc1...', paymentHash: 'hash123' });
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', async () => {
    vault.lock();
    const r = await handleWalletMakeInvoice({ amount: 5000 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });

  it('returns error when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = await handleWalletMakeInvoice({ amount: 5000 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'No wallet configured');
  });

  it('returns error when provider throws', async () => {
    setWalletProvider('acct1', createMockProvider({
      async makeInvoice() { throw new Error('Amount too large'); },
      isConnected() { return true; },
    }));
    const r = await handleWalletMakeInvoice({ amount: 999999999 });
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Amount too large');
  });
});

describe('wallet handlers: wallet_getNwcUri', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadWithWallet());
  });

  it('returns nwcUri when lnbits wallet has one', async () => {
    const nwcConfig: WalletConfig = {
      type: 'lnbits', instanceUrl: 'https://legend.lnbits.com',
      adminKey: 'testapikey123', nwcUri: 'nostr+walletconnect://test',
    };
    await vault.updateAccountWalletConfig('acct1', nwcConfig);
    const r = handleWalletGetNwcUri();
    assert.strictEqual(r.result, 'nostr+walletconnect://test');
    assert.strictEqual(r.error, null);
  });

  it('returns null when lnbits wallet has no nwcUri', () => {
    const r = handleWalletGetNwcUri();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, null);
  });

  it('returns null when no wallet configured', async () => {
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
    const r = handleWalletGetNwcUri();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, null);
  });

  it('returns error when vault is locked', () => {
    vault.lock();
    const r = handleWalletGetNwcUri();
    assert.strictEqual(r.result, null);
    assert.strictEqual(r.error, 'Vault is locked');
  });
});

describe('wallet handlers: wallet_provision', () => {
  beforeEach(async () => {
    resetMockStorage();
    clearWalletProviders();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayloadNoWallet());
  });

  it('provisions wallet and stores lnbits config with nwcUri', async () => {
    // Pre-set mock provider so getWalletProvider returns it instead of
    // creating a real LnbitsProvider that tries HTTP on connect()
    setWalletProvider('acct1', createMockProvider());

    const r = await handleWalletProvision({ instanceUrl: 'https://zaps.test.com' });
    assert.strictEqual(r, true);

    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct?.walletConfig);
    assert.strictEqual(acct.walletConfig.type, 'lnbits');
    assert.strictEqual((acct.walletConfig as { adminKey: string }).adminKey, 'prov-admin-key');
    assert.strictEqual((acct.walletConfig as { instanceUrl: string }).instanceUrl, 'https://zaps.test.com');
    assert.strictEqual(
      (acct.walletConfig as { nwcUri?: string }).nwcUri,
      'nostr+walletconnect://test-pubkey?relay=wss://relay.test&secret=test-secret',
    );
  });

  it('uses DEFAULT_LNBITS_URL when no instanceUrl provided', async () => {
    setWalletProvider('acct1', createMockProvider());

    const r = await handleWalletProvision({});
    assert.strictEqual(r, true);

    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct?.walletConfig);
    assert.strictEqual(acct.walletConfig.type, 'lnbits');
  });

  it('throws when vault is locked', async () => {
    vault.lock();
    await assert.rejects(
      () => handleWalletProvision({}),
      { message: 'Vault is locked' },
    );
  });

  it('throws when no active account', async () => {
    vault.clearActiveAccount();
    await assert.rejects(
      () => handleWalletProvision({}),
      { message: 'No active account' },
    );
  });
});
