import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.ts';
import type { VaultPayload, Account } from '../lib/types.ts';
import type { WalletConfig } from '../lib/wallet/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';

const LNBITS_CONFIG: WalletConfig = {
  type: 'lnbits',
  instanceUrl: 'https://legend.lnbits.com',
  adminKey: 'deadbeef1234567890abcdef',
  walletId: 'wallet-1',
};

const NWC_CONFIG: WalletConfig = {
  type: 'nwc',
  connectionString: 'nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex',
  relay: 'wss://relay.example.com',
};

function makeAccount(overrides?: Partial<Account>): Account {
  return {
    id: 'acct1',
    name: 'Test',
    type: 'nsec',
    pubkey: TEST_PUBKEY_HEX,
    privkey: TEST_PRIVKEY_HEX,
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: 1000000,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<Account>): VaultPayload {
  return {
    accounts: [makeAccount(overrides)],
    activeAccountId: 'acct1',
  };
}

describe('vault -- wallet config storage', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('stores and retrieves account with lnbits wallet config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.ok(acct);
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
  });

  it('stores and retrieves account with nwc wallet config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.ok(acct);
    assert.deepStrictEqual(acct!.walletConfig, NWC_CONFIG);
  });

  it('updateAccountWalletConfig persists config across lock/unlock', async () => {
    await vault.create(TEST_PASSWORD, makePayload());

    // Initially no wallet config
    let decrypted = vault.getDecryptedPayload();
    let acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);

    // Add wallet config
    await vault.updateAccountWalletConfig('acct1', LNBITS_CONFIG);

    // Verify in-memory
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);

    // Lock and re-unlock to verify persistence
    vault.lock();
    await vault.unlock(TEST_PASSWORD);
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
  });

  it('updateAccountWalletConfig with null removes config', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));

    // Confirm it exists
    let decrypted = vault.getDecryptedPayload();
    let acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.deepStrictEqual(acct!.walletConfig, NWC_CONFIG);

    // Remove it
    await vault.updateAccountWalletConfig('acct1', null);

    // Verify in-memory
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);

    // Verify persistence
    vault.lock();
    await vault.unlock(TEST_PASSWORD);
    decrypted = vault.getDecryptedPayload();
    acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.strictEqual(acct!.walletConfig, undefined);
  });

  it('listAccounts strips walletConfig', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const accounts = vault.listAccounts();
    assert.strictEqual(accounts.length, 1);
    // listAccounts only picks id, name, type, pubkey, readOnly, createdAt
    assert.strictEqual((accounts[0] as Record<string, unknown>).walletConfig, undefined);
    assert.strictEqual(accounts[0].id, 'acct1');
  });

  it('updateAccountWalletConfig throws when vault is locked', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    await assert.rejects(
      () => vault.updateAccountWalletConfig('acct1', LNBITS_CONFIG),
      /Vault is locked/
    );
  });

  it('updateAccountWalletConfig throws for nonexistent account', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    await assert.rejects(
      () => vault.updateAccountWalletConfig('nonexistent', LNBITS_CONFIG),
      /Account not found/
    );
  });

  it('getActiveAccountWithWallet returns account with walletConfig', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: LNBITS_CONFIG }));
    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct);
    assert.strictEqual(acct!.id, 'acct1');
    assert.strictEqual(acct!.pubkey, TEST_PUBKEY_HEX);
    assert.deepStrictEqual(acct!.walletConfig, LNBITS_CONFIG);
    // Should NOT have privkeyBytes or mnemonicBytes
    assert.strictEqual((acct as Record<string, unknown>).privkeyBytes, undefined);
    assert.strictEqual((acct as Record<string, unknown>).mnemonicBytes, undefined);
    // Should NOT have privkey or mnemonic
    assert.strictEqual((acct as Record<string, unknown>).privkey, undefined);
    assert.strictEqual((acct as Record<string, unknown>).mnemonic, undefined);
  });

  it('getActiveAccountWithWallet returns null when locked', async () => {
    await vault.create(TEST_PASSWORD, makePayload({ walletConfig: NWC_CONFIG }));
    vault.lock();
    const acct = vault.getActiveAccountWithWallet();
    assert.strictEqual(acct, null);
  });

  it('getActiveAccountWithWallet returns account without walletConfig when not set', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const acct = vault.getActiveAccountWithWallet();
    assert.ok(acct);
    assert.strictEqual(acct!.walletConfig, undefined);
  });
});
