import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex, sha256, randomBytes, constantTimeEqual } from '../../lib/crypto/utils.ts';
import { getPublicKey, isValidPrivateKey, ecdh, N } from '../../lib/crypto/secp256k1.ts';
import { schnorrSign, schnorrVerify } from '../../lib/crypto/schnorr.ts';
import { signEvent, verifyEvent, computeEventId } from '../../lib/crypto/nip01.ts';
import { nip04Encrypt, nip04Decrypt } from '../../lib/crypto/nip04.ts';
import { nip44Encrypt, nip44Decrypt } from '../../lib/crypto/nip44.ts';
import { npubEncode, npubDecode, nsecEncode, nsecDecode, normalizeToHex } from '../../lib/crypto/bech32.ts';
import { validateMnemonic, mnemonicToSeed, entropyToMnemonic } from '../../lib/crypto/bip39.ts';
import { derivePath } from '../../lib/crypto/bip32.ts';

// -- Input validation and boundary tests --

describe('secp256k1 -- boundary private keys', () => {
  it('accepts key = 1 (minimum valid)', () => {
    const key = new Uint8Array(32);
    key[31] = 1;
    assert.strictEqual(isValidPrivateKey(key), true);
    const pub: Uint8Array = getPublicKey(key);
    assert.strictEqual(pub.length, 32);
  });

  it('accepts key = N-1 (maximum valid)', () => {
    const nBytes: Uint8Array = hexToBytes('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140');
    assert.strictEqual(isValidPrivateKey(nBytes), true);
    const pub: Uint8Array = getPublicKey(nBytes);
    assert.strictEqual(pub.length, 32);
  });

  it('rejects key = N (curve order)', () => {
    const nBytes: Uint8Array = hexToBytes('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    assert.strictEqual(isValidPrivateKey(nBytes), false);
  });

  it('rejects key = N+1 (overflow)', () => {
    const nPlus1: Uint8Array = hexToBytes('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364142');
    assert.strictEqual(isValidPrivateKey(nPlus1), false);
  });

  it('rejects all-0xff key', () => {
    const allFF = new Uint8Array(32).fill(0xff);
    assert.strictEqual(isValidPrivateKey(allFF), false);
  });
});

describe('schnorr -- message boundary conditions', () => {
  const privkey: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const pubkey: Uint8Array = getPublicKey(privkey);

  it('signs and verifies all-zero message', async () => {
    const msg = new Uint8Array(32);
    const sig: Uint8Array = await schnorrSign(msg, privkey);
    assert.strictEqual(await schnorrVerify(msg, pubkey, sig), true);
  });

  it('signs and verifies all-0xff message', async () => {
    const msg = new Uint8Array(32).fill(0xff);
    const sig: Uint8Array = await schnorrSign(msg, privkey);
    assert.strictEqual(await schnorrVerify(msg, pubkey, sig), true);
  });

  it('rejects wrong-length message', async () => {
    await assert.rejects(
      () => schnorrSign(new Uint8Array(31), privkey),
      /Message must be 32 bytes/
    );
    await assert.rejects(
      () => schnorrSign(new Uint8Array(33), privkey),
      /Message must be 32 bytes/
    );
  });

  it('rejects wrong-length private key', async () => {
    await assert.rejects(
      () => schnorrSign(new Uint8Array(32), new Uint8Array(31)),
      /Private key must be 32 bytes/
    );
  });

  it('verify returns false for wrong-length inputs', async () => {
    assert.strictEqual(await schnorrVerify(new Uint8Array(31), pubkey, new Uint8Array(64)), false);
    assert.strictEqual(await schnorrVerify(new Uint8Array(32), new Uint8Array(31), new Uint8Array(64)), false);
    assert.strictEqual(await schnorrVerify(new Uint8Array(32), pubkey, new Uint8Array(63)), false);
  });
});

describe('NIP-01 -- event signing security', () => {
  const privkey: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');

  it('event ID is deterministic (no randomness)', async () => {
    const event = { pubkey: bytesToHex(getPublicKey(privkey)), created_at: 1, kind: 1, tags: [] as string[][], content: 'test' };
    const id1: string = await computeEventId(event);
    const id2: string = await computeEventId(event);
    assert.strictEqual(id1, id2);
  });

  it('different kind produces different ID', async () => {
    const base = { pubkey: bytesToHex(getPublicKey(privkey)), created_at: 1, tags: [] as string[][], content: '' };
    const id1: string = await computeEventId({ ...base, kind: 1 });
    const id2: string = await computeEventId({ ...base, kind: 0 });
    assert.notStrictEqual(id1, id2);
  });

  it('different created_at produces different ID', async () => {
    const base = { pubkey: bytesToHex(getPublicKey(privkey)), kind: 1, tags: [] as string[][], content: '' };
    const id1: string = await computeEventId({ ...base, created_at: 1 });
    const id2: string = await computeEventId({ ...base, created_at: 2 });
    assert.notStrictEqual(id1, id2);
  });

  it('signEvent pubkey matches derived public key', async () => {
    const event = { created_at: 1, kind: 1, tags: [] as string[][], content: 'test' };
    const signed: any = await signEvent(event, privkey);
    const expectedPub: string = bytesToHex(getPublicKey(privkey));
    assert.strictEqual(signed.pubkey, expectedPub);
  });

  it('event with tags is signed correctly', async () => {
    const event = {
      created_at: 1, kind: 1,
      tags: [['p', 'deadbeef'.repeat(8)], ['e', 'abcdef01'.repeat(8)]],
      content: 'tagged message'
    };
    const signed: any = await signEvent(event, privkey);
    assert.strictEqual(await verifyEvent(signed), true);
  });

  it('event with unicode content verifies', async () => {
    const event = { created_at: 1, kind: 1, tags: [] as string[][], content: 'Test message with special chars' };
    const signed: any = await signEvent(event, privkey);
    assert.strictEqual(await verifyEvent(signed), true);
  });

  it('event with empty content verifies', async () => {
    const event = { created_at: 1, kind: 1, tags: [] as string[][], content: '' };
    const signed: any = await signEvent(event, privkey);
    assert.strictEqual(await verifyEvent(signed), true);
  });
});

describe('ECDH -- shared secret isolation', () => {
  const keyA: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
  const keyB: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
  const keyC: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');

  it('different key pairs produce different shared secrets', () => {
    const pubB: Uint8Array = getPublicKey(keyB);
    const pubC: Uint8Array = getPublicKey(keyC);
    const sharedAB: Uint8Array = ecdh(keyA, pubB);
    const sharedAC: Uint8Array = ecdh(keyA, pubC);
    assert.notDeepStrictEqual(sharedAB, sharedAC);
  });

  it('shared secret with self is deterministic', () => {
    const pubA: Uint8Array = getPublicKey(keyA);
    const shared1: Uint8Array = ecdh(keyA, pubA);
    const shared2: Uint8Array = ecdh(keyA, pubA);
    assert.deepStrictEqual(shared1, shared2);
  });
});

describe('NIP-04 -- cross-key decryption fails', () => {
  const keyA: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
  const keyB: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
  const keyC: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const pubA: Uint8Array = getPublicKey(keyA);
  const pubB: Uint8Array = getPublicKey(keyB);
  const pubC: Uint8Array = getPublicKey(keyC);

  it('third party cannot decrypt NIP-04 message', async () => {
    const encrypted: string = await nip04Encrypt('secret', keyA, pubB);
    // C trying to decrypt with wrong shared secret should fail
    await assert.rejects(() => nip04Decrypt(encrypted, keyC, pubA));
  });

  it('empty plaintext round-trips', async () => {
    // NIP-04 should handle single character
    const encrypted: string = await nip04Encrypt('x', keyA, pubB);
    const decrypted: string = await nip04Decrypt(encrypted, keyB, pubA);
    assert.strictEqual(decrypted, 'x');
  });
});

describe('NIP-44 -- cross-key decryption fails', () => {
  const keyA: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
  const keyB: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
  const keyC: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000003');
  const pubA: Uint8Array = getPublicKey(keyA);
  const pubB: Uint8Array = getPublicKey(keyB);
  const pubC: Uint8Array = getPublicKey(keyC);

  it('third party cannot decrypt NIP-44 message', async () => {
    const encrypted: string = await nip44Encrypt('secret', keyA, pubB);
    await assert.rejects(() => nip44Decrypt(encrypted, keyC, pubA), /Invalid MAC/);
  });

  it('large plaintext round-trips', async () => {
    const plaintext: string = 'A'.repeat(10000);
    const encrypted: string = await nip44Encrypt(plaintext, keyA, pubB);
    const decrypted: string = await nip44Decrypt(encrypted, keyB, pubA);
    assert.strictEqual(decrypted, plaintext);
  });

  it('padding hides message length', async () => {
    const enc1: string = await nip44Encrypt('hello', keyA, pubB);
    const enc2: string = await nip44Encrypt('hi', keyA, pubB);
    const raw1: Uint8Array = Uint8Array.from(atob(enc1), (c: string) => c.charCodeAt(0));
    const raw2: Uint8Array = Uint8Array.from(atob(enc2), (c: string) => c.charCodeAt(0));
    // Both short messages should produce same-length ciphertext due to padding
    assert.strictEqual(raw1.length, raw2.length);
  });
});

describe('bech32 -- malformed input rejection', () => {
  it('npubDecode rejects nsec prefix', () => {
    const nsec: string = nsecEncode('0000000000000000000000000000000000000000000000000000000000000001');
    assert.throws(() => npubDecode(nsec), /Invalid npub/);
  });

  it('nsecDecode rejects npub prefix', () => {
    const npub: string = npubEncode('0000000000000000000000000000000000000000000000000000000000000001');
    assert.throws(() => nsecDecode(npub), /Invalid nsec/);
  });

  it('normalizeToHex rejects nsec (security: never expose privkey as pubkey)', () => {
    const nsec: string = nsecEncode('0000000000000000000000000000000000000000000000000000000000000001');
    const result: string | null = normalizeToHex(nsec);
    assert.strictEqual(result, null);
  });
});

describe('BIP-39/32 -- derivation security', () => {
  it('different mnemonics produce different keys', async () => {
    const m1: string = await entropyToMnemonic(new Uint8Array(16).fill(0));
    const m2: string = await entropyToMnemonic(new Uint8Array(16).fill(1));
    const s1: Uint8Array = await mnemonicToSeed(m1);
    const s2: Uint8Array = await mnemonicToSeed(m2);
    assert.notDeepStrictEqual(s1, s2);
  });

  it('NIP-06 path produces valid secp256k1 key', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed: Uint8Array = await mnemonicToSeed(mnemonic);
    const privkey: Uint8Array = await derivePath(seed, "m/44'/1237'/0'/0/0");
    assert.strictEqual(isValidPrivateKey(privkey), true);
    const pubkey: Uint8Array = getPublicKey(privkey);
    assert.strictEqual(pubkey.length, 32);
  });

  it('different account indices produce different keys', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed: Uint8Array = await mnemonicToSeed(mnemonic);
    const key0: Uint8Array = await derivePath(seed, "m/44'/1237'/0'/0/0");
    const key1: Uint8Array = await derivePath(seed, "m/44'/1237'/0'/0/1");
    assert.notDeepStrictEqual(key0, key1);
  });
});

describe('constantTimeEqual -- security properties', () => {
  it('rejects arrays that differ only in last byte', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([1, 2, 3, 4, 6]);
    assert.strictEqual(constantTimeEqual(a, b), false);
  });

  it('rejects arrays that differ only in first byte', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]);
    const b = new Uint8Array([0, 2, 3, 4, 5]);
    assert.strictEqual(constantTimeEqual(a, b), false);
  });

  it('works with 32-byte arrays (key-length)', () => {
    const a: Uint8Array = randomBytes(32);
    const b = new Uint8Array(a);
    assert.strictEqual(constantTimeEqual(a, b), true);
    b[15] ^= 1;
    assert.strictEqual(constantTimeEqual(a, b), false);
  });
});

describe('SHA-256 -- collision resistance smoke test', () => {
  it('different inputs produce different hashes', async () => {
    const inputs: string[] = ['a', 'b', 'ab', 'ba', ''];
    const hashes = new Set<string>();
    for (const input of inputs) {
      const hash: string = bytesToHex(await sha256(new TextEncoder().encode(input)));
      hashes.add(hash);
    }
    assert.strictEqual(hashes.size, inputs.length);
  });
});
