import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  hexToBytes, bytesToHex, concatBytes, constantTimeEqual,
  sha256, randomBytes, writeU32BE, readU32BE
} from '../../lib/crypto/utils.js';

describe('hexToBytes / bytesToHex', () => {
  it('round-trips correctly', () => {
    const hex = 'deadbeef01020304';
    assert.deepStrictEqual(bytesToHex(hexToBytes(hex)), hex);
  });

  it('converts known hex to bytes', () => {
    const bytes = hexToBytes('ff00ab');
    assert.deepStrictEqual(bytes, new Uint8Array([0xff, 0x00, 0xab]));
  });

  it('handles empty string', () => {
    assert.deepStrictEqual(hexToBytes(''), new Uint8Array([]));
    assert.strictEqual(bytesToHex(new Uint8Array([])), '');
  });

  it('rejects odd-length hex', () => {
    assert.throws(() => hexToBytes('abc'), /hex/);
  });

  it('rejects invalid hex characters', () => {
    assert.throws(() => hexToBytes('zzzz'), /hex/);
  });
});

describe('concatBytes', () => {
  it('merges multiple arrays', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    const c = new Uint8Array([4, 5, 6]);
    const result = concatBytes(a, b, c);
    assert.deepStrictEqual(result, new Uint8Array([1, 2, 3, 4, 5, 6]));
  });

  it('handles empty arrays', () => {
    const a = new Uint8Array([1]);
    const result = concatBytes(a, new Uint8Array([]), a);
    assert.deepStrictEqual(result, new Uint8Array([1, 1]));
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    assert.strictEqual(constantTimeEqual(a, b), true);
  });

  it('returns false for different arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 4]);
    assert.strictEqual(constantTimeEqual(a, b), false);
  });

  it('returns false for different lengths', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([1, 2, 3]);
    assert.strictEqual(constantTimeEqual(a, b), false);
  });
});

describe('sha256', () => {
  it('matches known digest for empty input', async () => {
    const hash = await sha256(new Uint8Array([]));
    assert.strictEqual(
      bytesToHex(hash),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('matches known digest for "abc"', async () => {
    const data = new TextEncoder().encode('abc');
    const hash = await sha256(data);
    assert.strictEqual(
      bytesToHex(hash),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('randomBytes', () => {
  it('returns correct length', () => {
    assert.strictEqual(randomBytes(32).length, 32);
    assert.strictEqual(randomBytes(16).length, 16);
    assert.strictEqual(randomBytes(0).length, 0);
  });

  it('returns different values on successive calls', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    // Extremely unlikely to be equal
    assert.strictEqual(constantTimeEqual(a, b), false);
  });
});

describe('writeU32BE / readU32BE', () => {
  it('round-trips correctly', () => {
    const values: number[] = [0, 1, 255, 65535, 0x80000000, 0xFFFFFFFF];
    for (const v of values) {
      assert.strictEqual(readU32BE(writeU32BE(v)), v);
    }
  });
});
