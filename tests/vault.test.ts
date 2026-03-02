import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.js';
import type { VaultPayload } from '../lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';

function makePayload(privkey: string = TEST_PRIVKEY_HEX, pubkey: string = TEST_PUBKEY_HEX): VaultPayload {
  return {
    accounts: [{
      id: 'acct1',
      name: 'Test',
      type: 'nsec',
      pubkey,
      privkey,
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 1000000
    }],
    activeAccountId: 'acct1'
  };
}

describe('vault -- create and unlock', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('create stores encrypted vault and unlocks', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    assert.strictEqual(vault.isLocked(), false);
    assert.strictEqual(vault.getActivePubkey(), TEST_PUBKEY_HEX);
  });

  it('exists returns true after create', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    assert.strictEqual(await vault.exists(), true);
  });

  it('exists returns false when empty', async () => {
    assert.strictEqual(await vault.exists(), false);
  });

  it('unlock with correct password succeeds', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    assert.strictEqual(vault.isLocked(), true);
    const result: boolean = await vault.unlock(TEST_PASSWORD);
    assert.strictEqual(result, true);
    assert.strictEqual(vault.isLocked(), false);
  });

  it('unlock with wrong password fails', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    const result: boolean = await vault.unlock('wrongpassword');
    assert.strictEqual(result, false);
    assert.strictEqual(vault.isLocked(), true);
  });

  it('unlock with no vault throws', async () => {
    await assert.rejects(() => vault.unlock(TEST_PASSWORD), /No vault found/);
  });
});

describe('vault -- lock/unlock cycle integrity', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('data persists across lock/unlock', async () => {
    const payload: VaultPayload = makePayload();
    await vault.create(TEST_PASSWORD, payload);

    vault.lock();
    assert.strictEqual(vault.getActivePubkey(), null);

    await vault.unlock(TEST_PASSWORD);
    assert.strictEqual(vault.getActivePubkey(), TEST_PUBKEY_HEX);
    assert.strictEqual(vault.getActiveAccountId(), 'acct1');
  });

  it('lock clears all in-memory data', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    assert.strictEqual(vault.isLocked(), false);

    vault.lock();
    assert.strictEqual(vault.isLocked(), true);
    assert.strictEqual(vault.getActivePubkey(), null);
    assert.strictEqual(vault.getActiveAccountId(), null);
    assert.strictEqual(vault.getActiveAccount(), null);
    assert.deepStrictEqual(vault.listAccounts(), []);
  });
});

describe('vault -- private key security', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
  });

  it('getPrivkey returns 32-byte Uint8Array', () => {
    const privkey: any = vault.getPrivkey();
    assert.ok(privkey instanceof Uint8Array);
    assert.strictEqual(privkey.length, 32);
  });

  it('getPrivkey can be zeroed after use', () => {
    const privkey: any = vault.getPrivkey();
    assert.ok(privkey.some((b: number) => b !== 0)); // Not all zeros initially

    privkey.fill(0);
    assert.ok(privkey.every((b: number) => b === 0)); // All zeros after fill
  });

  it('getPrivkey throws when vault is locked', () => {
    vault.lock();
    assert.throws(() => vault.getPrivkey(), /Vault is locked/);
  });

  it('getPrivkey returns null for nonexistent account', () => {
    const result: any = vault.getPrivkey('nonexistent');
    assert.strictEqual(result, null);
  });
});

describe('vault -- account management', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
  });

  it('listAccounts returns public info only (no privkeys)', () => {
    const accounts: any[] = vault.listAccounts();
    assert.strictEqual(accounts.length, 1);
    assert.strictEqual(accounts[0].pubkey, TEST_PUBKEY_HEX);
    assert.strictEqual(accounts[0].privkey, undefined);
    assert.strictEqual(accounts[0].mnemonic, undefined);
  });

  it('getActiveAccount returns account object', () => {
    const acct: any = vault.getActiveAccount();
    assert.strictEqual(acct.id, 'acct1');
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
  });

  it('addAccount adds to vault', async () => {
    await vault.addAccount({
      id: 'acct2', name: 'Second', type: 'npub',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      privkey: null, readOnly: true, createdAt: 2000000
    } as any);
    const accounts: any[] = vault.listAccounts();
    assert.strictEqual(accounts.length, 2);
  });

  it('removeAccount removes from vault', async () => {
    await vault.addAccount({
      id: 'acct2', name: 'Second', type: 'npub',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      privkey: null, readOnly: true, createdAt: 2000000
    } as any);
    await vault.removeAccount('acct2');
    assert.strictEqual(vault.listAccounts().length, 1);
  });

  it('removeAccount switches active if removed account was active', async () => {
    await vault.addAccount({
      id: 'acct2', name: 'Second', type: 'nsec',
      pubkey: '0000000000000000000000000000000000000000000000000000000000000001',
      privkey: '0000000000000000000000000000000000000000000000000000000000000002',
      readOnly: false, createdAt: 2000000
    } as any);
    await vault.setActiveAccount('acct2');
    await vault.removeAccount('acct2');
    // Should fall back to first account
    assert.strictEqual(vault.getActiveAccountId(), 'acct1');
  });

  it('setActiveAccount throws for unknown account', async () => {
    await assert.rejects(
      () => vault.setActiveAccount('nonexistent'),
      /Account not found/
    );
  });

  it('addAccount throws when locked', async () => {
    vault.lock();
    await assert.rejects(
      () => vault.addAccount({ id: 'x' } as any),
      /Vault is locked/
    );
  });
});

describe('vault -- seed export', () => {
  const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('getDecryptedPayload returns mnemonic for generated account', async () => {
    const payload: VaultPayload = {
      accounts: [{
        id: 'seed1',
        name: 'Generated',
        type: 'generated',
        pubkey: TEST_PUBKEY_HEX,
        privkey: TEST_PRIVKEY_HEX,
        mnemonic: TEST_MNEMONIC,
        nip46Config: null,
        readOnly: false,
        createdAt: 1000000
      }],
      activeAccountId: 'seed1'
    };
    await vault.create(TEST_PASSWORD, payload);
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'seed1');
    assert.ok(acct);
    assert.strictEqual(acct!.type, 'generated');
    assert.strictEqual(acct!.mnemonic, TEST_MNEMONIC);
    assert.strictEqual(acct!.mnemonic!.split(' ').length, 12);
  });

  it('getDecryptedPayload throws when vault is locked', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    vault.lock();
    assert.throws(() => vault.getDecryptedPayload(), /Vault is locked/);
  });

  it('nsec account has no mnemonic', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'acct1');
    assert.ok(acct);
    assert.strictEqual(acct!.mnemonic, null);
  });

  it('mnemonic persists across lock/unlock', async () => {
    const payload: VaultPayload = {
      accounts: [{
        id: 'seed1',
        name: 'Generated',
        type: 'generated',
        pubkey: TEST_PUBKEY_HEX,
        privkey: TEST_PRIVKEY_HEX,
        mnemonic: TEST_MNEMONIC,
        nip46Config: null,
        readOnly: false,
        createdAt: 1000000
      }],
      activeAccountId: 'seed1'
    };
    await vault.create(TEST_PASSWORD, payload);
    vault.lock();
    await vault.unlock(TEST_PASSWORD);
    const decrypted = vault.getDecryptedPayload();
    const acct = decrypted.accounts.find(a => a.id === 'seed1');
    assert.strictEqual(acct!.mnemonic, TEST_MNEMONIC);
  });
});

describe('vault -- encryption integrity', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('different passwords produce different ciphertexts', async () => {
    const payload: VaultPayload = makePayload();

    await vault.create('password1', payload);
    const { default: mock } = await import('./helpers/browser-mock.ts');
    const data1: any = await mock.storage.local.get('keyVault');
    const ct1: string = data1.keyVault.ciphertext;

    resetMockStorage();
    vault.lock();

    await vault.create('password2', payload);
    const data2: any = await mock.storage.local.get('keyVault');
    const ct2: string = data2.keyVault.ciphertext;

    assert.notStrictEqual(ct1, ct2);
  });

  it('same password produces different IVs (random)', async () => {
    const payload: VaultPayload = makePayload();

    await vault.create(TEST_PASSWORD, payload);
    const { default: mock } = await import('./helpers/browser-mock.ts');
    const data1: any = await mock.storage.local.get('keyVault');
    const iv1: string = data1.keyVault.iv;

    resetMockStorage();
    vault.lock();

    await vault.create(TEST_PASSWORD, payload);
    const data2: any = await mock.storage.local.get('keyVault');
    const iv2: string = data2.keyVault.iv;

    assert.notStrictEqual(iv1, iv2);
  });

  it('vault stores version, salt, iv, ciphertext', async () => {
    await vault.create(TEST_PASSWORD, makePayload());
    const { default: mock } = await import('./helpers/browser-mock.ts');
    const data: any = await mock.storage.local.get('keyVault');
    const v: any = data.keyVault;

    assert.strictEqual(v.version, 1);
    assert.ok(typeof v.salt === 'string' && v.salt.length > 0);
    assert.ok(typeof v.iv === 'string' && v.iv.length > 0);
    assert.ok(typeof v.ciphertext === 'string' && v.ciphertext.length > 0);
  });
});
