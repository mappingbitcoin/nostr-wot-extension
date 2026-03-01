import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createFromMnemonic, createFromMnemonicAtIndex, generateNewAccount, importNsec, importNpub, connectNip46
} from '../lib/accounts.js';
import { nsecEncode, npubEncode } from '../lib/crypto/bech32.js';

const VALID_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';

describe('createFromMnemonic', () => {
  it('creates account from valid mnemonic', async () => {
    const acct: any = await createFromMnemonic(VALID_MNEMONIC, 'Test');
    assert.strictEqual(acct.type, 'generated');
    assert.strictEqual(acct.name, 'Test');
    assert.strictEqual(acct.readOnly, false);
    assert.match(acct.pubkey, /^[0-9a-f]{64}$/);
    assert.match(acct.privkey, /^[0-9a-f]{64}$/);
    assert.strictEqual(acct.mnemonic, VALID_MNEMONIC);
    assert.ok(acct.id);
    assert.ok(acct.createdAt > 0);
  });

  it('same mnemonic produces same keys', async () => {
    const acct1: any = await createFromMnemonic(VALID_MNEMONIC);
    const acct2: any = await createFromMnemonic(VALID_MNEMONIC);
    assert.strictEqual(acct1.pubkey, acct2.pubkey);
    assert.strictEqual(acct1.privkey, acct2.privkey);
  });

  it('generates unique IDs', async () => {
    const acct1: any = await createFromMnemonic(VALID_MNEMONIC);
    const acct2: any = await createFromMnemonic(VALID_MNEMONIC);
    assert.notStrictEqual(acct1.id, acct2.id);
  });

  it('rejects invalid mnemonic', async () => {
    await assert.rejects(
      () => createFromMnemonic('invalid mnemonic phrase'),
      /Invalid mnemonic/
    );
  });

  it('rejects mnemonic with wrong checksum', async () => {
    await assert.rejects(
      () => createFromMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo'),
      /Invalid mnemonic/
    );
  });
});

describe('createFromMnemonicAtIndex', () => {
  it('creates sub-account at specified index', async () => {
    const acct: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 1);
    assert.strictEqual(acct.type, 'generated');
    assert.strictEqual(acct.derivationIndex, 1);
    assert.match(acct.pubkey, /^[0-9a-f]{64}$/);
    assert.match(acct.privkey, /^[0-9a-f]{64}$/);
    assert.strictEqual(acct.mnemonic, VALID_MNEMONIC);
    assert.strictEqual(acct.readOnly, false);
  });

  it('index 0 produces same keys as createFromMnemonic', async () => {
    const base: any = await createFromMnemonic(VALID_MNEMONIC);
    const atZero: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 0);
    assert.strictEqual(base.pubkey, atZero.pubkey);
    assert.strictEqual(base.privkey, atZero.privkey);
  });

  it('different indices produce different keys', async () => {
    const a0: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 0);
    const a1: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 1);
    const a2: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 2);
    assert.notStrictEqual(a0.pubkey, a1.pubkey);
    assert.notStrictEqual(a1.pubkey, a2.pubkey);
    assert.notStrictEqual(a0.pubkey, a2.pubkey);
  });

  it('uses default name with index', async () => {
    const acct: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 3);
    assert.strictEqual(acct.name, 'Account 4');
  });

  it('accepts custom name', async () => {
    const acct: any = await createFromMnemonicAtIndex(VALID_MNEMONIC, 1, 'My Sub');
    assert.strictEqual(acct.name, 'My Sub');
  });

  it('rejects invalid mnemonic', async () => {
    await assert.rejects(
      () => createFromMnemonicAtIndex('invalid words here', 1),
      /Invalid mnemonic/
    );
  });
});

describe('generateNewAccount', () => {
  it('generates valid 12-word mnemonic and account', async () => {
    const { account, mnemonic }: any = await generateNewAccount('New');
    assert.strictEqual(mnemonic.split(' ').length, 12);
    assert.strictEqual(account.type, 'generated');
    assert.strictEqual(account.name, 'New');
    assert.match(account.pubkey, /^[0-9a-f]{64}$/);
    assert.match(account.privkey, /^[0-9a-f]{64}$/);
  });

  it('different calls produce different keys', async () => {
    const a: any = await generateNewAccount();
    const b: any = await generateNewAccount();
    assert.notStrictEqual(a.account.pubkey, b.account.pubkey);
    assert.notStrictEqual(a.mnemonic, b.mnemonic);
  });
});

describe('importNsec', () => {
  it('imports from nsec bech32', async () => {
    const nsec: string = nsecEncode(TEST_PRIVKEY_HEX);
    const acct: any = await importNsec(nsec, 'Imported');
    assert.strictEqual(acct.type, 'nsec');
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
    assert.strictEqual(acct.privkey, TEST_PRIVKEY_HEX);
    assert.strictEqual(acct.readOnly, false);
    assert.strictEqual(acct.mnemonic, null);
  });

  it('imports from hex private key', async () => {
    const acct: any = await importNsec(TEST_PRIVKEY_HEX);
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
    assert.strictEqual(acct.privkey, TEST_PRIVKEY_HEX);
  });

  it('imports uppercase hex', async () => {
    const acct: any = await importNsec(TEST_PRIVKEY_HEX.toUpperCase());
    assert.strictEqual(acct.privkey, TEST_PRIVKEY_HEX);
  });

  it('rejects invalid input', async () => {
    await assert.rejects(() => importNsec('not-a-key'), /Invalid nsec or hex/);
    await assert.rejects(() => importNsec('abc123'), /Invalid nsec or hex/);
    await assert.rejects(() => importNsec(''), /Invalid nsec or hex/);
  });

  it('rejects npub (wrong type)', async () => {
    const npub: string = npubEncode(TEST_PUBKEY_HEX);
    await assert.rejects(() => importNsec(npub), /Invalid nsec or hex/);
  });
});

describe('importNpub', () => {
  it('imports from npub bech32', () => {
    const npub: string = npubEncode(TEST_PUBKEY_HEX);
    const acct: any = importNpub(npub, 'Watch');
    assert.strictEqual(acct.type, 'npub');
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
    assert.strictEqual(acct.privkey, null);
    assert.strictEqual(acct.readOnly, true);
  });

  it('imports from hex pubkey', () => {
    const acct: any = importNpub(TEST_PUBKEY_HEX);
    assert.strictEqual(acct.pubkey, TEST_PUBKEY_HEX);
    assert.strictEqual(acct.readOnly, true);
  });

  it('rejects invalid input', () => {
    assert.throws(() => importNpub('not-valid'), /Invalid npub or hex/);
    assert.throws(() => importNpub(''), /Invalid npub or hex/);
  });
});

describe('connectNip46', () => {
  it('creates NIP-46 account from bunker URL', () => {
    const bunkerUrl = 'bunker://dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659?relay=wss://relay.example.com&secret=mysecret';
    const acct: any = connectNip46(bunkerUrl, 'Bunker');
    assert.strictEqual(acct.type, 'nip46');
    assert.strictEqual(acct.readOnly, false);
    assert.strictEqual(acct.privkey, null);
    assert.ok(acct.nip46Config);
    assert.strictEqual(acct.nip46Config.bunkerUrl, bunkerUrl);
    assert.strictEqual(acct.nip46Config.relay, 'wss://relay.example.com');
    assert.strictEqual(acct.nip46Config.secret, 'mysecret');
  });

  it('rejects invalid bunker URL (short pubkey)', () => {
    assert.throws(
      () => connectNip46('bunker://shortpubkey?relay=wss://relay.example.com'),
      /Invalid bunker URL/
    );
  });
});

describe('account type coverage', () => {
  it('generated account has all required fields', async () => {
    const { account }: any = await generateNewAccount();
    assert.ok(account.id);
    assert.ok(account.name);
    assert.strictEqual(account.type, 'generated');
    assert.match(account.pubkey, /^[0-9a-f]{64}$/);
    assert.match(account.privkey, /^[0-9a-f]{64}$/);
    assert.ok(account.mnemonic);
    assert.strictEqual(account.nip46Config, null);
    assert.strictEqual(account.readOnly, false);
    assert.ok(typeof account.createdAt === 'number');
    assert.strictEqual(account.derivationIndex, 0);
  });

  it('nsec account has correct field pattern', async () => {
    const acct: any = await importNsec(TEST_PRIVKEY_HEX);
    assert.strictEqual(acct.type, 'nsec');
    assert.ok(acct.privkey);
    assert.strictEqual(acct.mnemonic, null);
    assert.strictEqual(acct.readOnly, false);
  });

  it('npub account has correct field pattern', () => {
    const acct: any = importNpub(TEST_PUBKEY_HEX);
    assert.strictEqual(acct.type, 'npub');
    assert.strictEqual(acct.privkey, null);
    assert.strictEqual(acct.mnemonic, null);
    assert.strictEqual(acct.readOnly, true);
  });

  it('nip46 account has correct field pattern', () => {
    const acct: any = connectNip46('bunker://dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659?relay=wss://r.example.com');
    assert.strictEqual(acct.type, 'nip46');
    assert.strictEqual(acct.privkey, null);
    assert.strictEqual(acct.readOnly, false);
    assert.ok(acct.nip46Config);
  });
});
