import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.ts';
import {
  getPublicKey, isValidPrivateKey, liftX, ecdh, N
} from '../../lib/crypto/secp256k1.ts';

// BIP-340 test vector 0: known privkey -> pubkey
const VEC0_SECKEY = '0000000000000000000000000000000000000000000000000000000000000003';
const VEC0_PUBKEY = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

// BIP-340 test vector 1
const VEC1_SECKEY = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const VEC1_PUBKEY = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';

describe('getPublicKey', () => {
  it('derives correct pubkey for BIP-340 vector 0', () => {
    const pubkey = getPublicKey(hexToBytes(VEC0_SECKEY));
    assert.strictEqual(bytesToHex(pubkey), VEC0_PUBKEY);
  });

  it('derives correct pubkey for BIP-340 vector 1', () => {
    const pubkey = getPublicKey(hexToBytes(VEC1_SECKEY));
    assert.strictEqual(bytesToHex(pubkey), VEC1_PUBKEY);
  });

  it('rejects zero private key', () => {
    const zero = new Uint8Array(32);
    assert.throws(() => getPublicKey(zero), /invalid|out of range/i);
  });

  it('rejects private key >= N', () => {
    // N itself as bytes (should be rejected)
    const nBytes = hexToBytes('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    assert.throws(() => getPublicKey(nBytes), /invalid|out of range/i);
  });
});

describe('isValidPrivateKey', () => {
  it('accepts valid key', () => {
    assert.strictEqual(isValidPrivateKey(hexToBytes(VEC0_SECKEY)), true);
  });

  it('rejects zero', () => {
    assert.strictEqual(isValidPrivateKey(new Uint8Array(32)), false);
  });

  it('rejects key >= N', () => {
    const nBytes = hexToBytes('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    assert.strictEqual(isValidPrivateKey(nBytes), false);
  });

  it('rejects wrong length', () => {
    assert.strictEqual(isValidPrivateKey(new Uint8Array(31)), false);
    assert.strictEqual(isValidPrivateKey(new Uint8Array(33)), false);
  });

  it('rejects non-Uint8Array', () => {
    assert.strictEqual(isValidPrivateKey('not bytes' as any), false);
  });
});

describe('liftX', () => {
  it('recovers correct point with even y', () => {
    const point = liftX(hexToBytes(VEC0_PUBKEY));
    assert.strictEqual(point.y % 2n, 0n); // y is even
  });

  it('round-trips: getPublicKey then liftX', () => {
    const privkey = hexToBytes(VEC1_SECKEY);
    const pubkey = getPublicKey(privkey);
    const point = liftX(pubkey);
    // x-coordinate should match the pubkey bytes
    assert.strictEqual(point.x.toString(16), VEC1_PUBKEY.replace(/^0+/, ''));
  });
});

describe('ecdh', () => {
  it('shared secret is symmetric', () => {
    const privA = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const privB = hexToBytes(VEC0_SECKEY);
    const pubA = getPublicKey(privA);
    const pubB = getPublicKey(privB);

    const sharedAB = ecdh(privA, pubB);
    const sharedBA = ecdh(privB, pubA);
    assert.deepStrictEqual(sharedAB, sharedBA);
  });

  it('produces 32-byte output', () => {
    const priv = hexToBytes(VEC1_SECKEY);
    const pub = getPublicKey(hexToBytes(VEC0_SECKEY));
    const shared = ecdh(priv, pub);
    assert.strictEqual(shared.length, 32);
  });
});
