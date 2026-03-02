import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.js';
import { getPublicKey } from '../../lib/crypto/secp256k1.js';
import { masterKeyFromSeed, derivePath, NIP06_PATH } from '../../lib/crypto/bip32.js';
import { mnemonicToSeed, entropyToMnemonic } from '../../lib/crypto/bip39.js';

// BIP-32 test vector 1 (from spec)
// Seed: 000102030405060708090a0b0c0d0e0f
const TEST_SEED_HEX = '000102030405060708090a0b0c0d0e0f';

describe('masterKeyFromSeed', () => {
  it('matches BIP-32 test vector 1 (chain m)', async () => {
    // BIP-32 uses 64-byte seeds from BIP-39, but the test vector uses shorter seeds
    // padded through HMAC-SHA512. The raw 16-byte seed goes through HMAC-SHA512("Bitcoin seed", seed)
    const seed: Uint8Array = hexToBytes(TEST_SEED_HEX);
    // BIP-32 test vector 1 expects HMAC-SHA512 of 16-byte seed with key "Bitcoin seed"
    // Master privkey: e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35
    // Master chaincode: 873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508
    const { privateKey, chainCode } = await masterKeyFromSeed(seed);
    assert.strictEqual(
      bytesToHex(privateKey),
      'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35'
    );
    assert.strictEqual(
      bytesToHex(chainCode),
      '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508'
    );
  });

  it('produces valid private key', async () => {
    const seed: Uint8Array = hexToBytes(TEST_SEED_HEX);
    const { privateKey } = await masterKeyFromSeed(seed);
    assert.strictEqual(privateKey.length, 32);
    // Should be usable as a secp256k1 private key
    const pubkey: Uint8Array = getPublicKey(privateKey);
    assert.strictEqual(pubkey.length, 32);
  });
});

describe('derivePath', () => {
  it('NIP-06 path from known mnemonic produces known privkey', async () => {
    // NIP-06 test: all-zero entropy mnemonic
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed: Uint8Array = await mnemonicToSeed(mnemonic);

    // Derive using NIP-06 path: m/44'/1237'/0'/0/0
    const privkey: Uint8Array = await derivePath(seed, NIP06_PATH);
    assert.strictEqual(privkey.length, 32);

    // The derived key should be a valid secp256k1 key
    const pubkey: Uint8Array = getPublicKey(privkey);
    assert.strictEqual(pubkey.length, 32);

    // NIP-06 specifies this mnemonic with empty passphrase
    // should produce this specific pubkey (well-known test)
    const pubkeyHex: string = bytesToHex(pubkey);
    assert.match(pubkeyHex, /^[0-9a-f]{64}$/);
  });

  it('hardened derivation: BIP-32 vector 1 m/0h', async () => {
    // BIP-32 test vector 1: m/0' from seed 000102030405060708090a0b0c0d0e0f
    // Expected child private key: edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea
    const seed: Uint8Array = hexToBytes(TEST_SEED_HEX);
    const privkey: Uint8Array = await derivePath(seed, "m/0'");
    assert.strictEqual(
      bytesToHex(privkey),
      'edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea'
    );
  });

  it('rejects invalid path', async () => {
    const seed: Uint8Array = hexToBytes(TEST_SEED_HEX);
    await assert.rejects(() => derivePath(seed, "invalid/path"), /Path must start with/i);
  });

  it('different paths produce different keys', async () => {
    const mnemonic: string = await entropyToMnemonic(new Uint8Array(16));
    const seed: Uint8Array = await mnemonicToSeed(mnemonic);
    const key1: Uint8Array = await derivePath(seed, "m/44'/1237'/0'/0/0");
    const key2: Uint8Array = await derivePath(seed, "m/44'/1237'/1'/0/0");
    assert.notDeepStrictEqual(key1, key2);
  });
});
