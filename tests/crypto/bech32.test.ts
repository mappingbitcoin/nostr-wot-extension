import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.js';
import {
  npubEncode, npubDecode, nsecEncode, nsecDecode,
  nprofileEncode, nprofileDecode, normalizeToHex,
  bech32Encode, bech32Decode
} from '../../lib/crypto/bech32.js';

const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';

describe('npubEncode / npubDecode', () => {
  it('round-trips correctly with hex string', () => {
    const npub = npubEncode(TEST_PUBKEY_HEX);
    assert.ok(npub.startsWith('npub1'));
    const decoded = npubDecode(npub);
    assert.strictEqual(decoded, TEST_PUBKEY_HEX);
  });

  it('round-trips correctly with Uint8Array', () => {
    const bytes = hexToBytes(TEST_PUBKEY_HEX);
    const npub = npubEncode(bytes);
    const decoded = npubDecode(npub);
    assert.strictEqual(decoded, TEST_PUBKEY_HEX);
  });

  it('rejects invalid npub', () => {
    assert.throws(() => npubDecode('npub1invalid'), /Invalid/);
    assert.throws(() => npubDecode('nsec1' + 'q'.repeat(58)), /Invalid npub/);
  });
});

describe('nsecEncode / nsecDecode', () => {
  it('round-trips correctly', () => {
    const nsec = nsecEncode(TEST_PRIVKEY_HEX);
    assert.ok(nsec.startsWith('nsec1'));
    const decoded = nsecDecode(nsec);
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('rejects invalid nsec', () => {
    assert.throws(() => nsecDecode('nsec1invalid'), /Invalid/);
  });
});

describe('nprofileEncode / nprofileDecode', () => {
  it('round-trips with no relays', () => {
    const nprofile = nprofileEncode(TEST_PUBKEY_HEX);
    assert.ok(nprofile.startsWith('nprofile1'));
    const decoded = nprofileDecode(nprofile);
    assert.strictEqual(decoded.pubkey, TEST_PUBKEY_HEX);
    assert.deepStrictEqual(decoded.relays, []);
  });

  it('round-trips with relays', () => {
    const relays: string[] = ['wss://relay.damus.io', 'wss://nos.lol'];
    const nprofile = nprofileEncode(TEST_PUBKEY_HEX, relays);
    const decoded = nprofileDecode(nprofile);
    assert.strictEqual(decoded.pubkey, TEST_PUBKEY_HEX);
    assert.deepStrictEqual(decoded.relays, relays);
  });

  it('rejects invalid nprofile', () => {
    assert.throws(() => nprofileDecode('nprofile1invalid'), /Invalid/);
  });
});

describe('normalizeToHex', () => {
  it('passes through valid hex', () => {
    assert.strictEqual(normalizeToHex(TEST_PUBKEY_HEX), TEST_PUBKEY_HEX);
  });

  it('normalizes uppercase hex', () => {
    assert.strictEqual(normalizeToHex(TEST_PUBKEY_HEX.toUpperCase()), TEST_PUBKEY_HEX);
  });

  it('handles npub', () => {
    const npub = npubEncode(TEST_PUBKEY_HEX);
    assert.strictEqual(normalizeToHex(npub), TEST_PUBKEY_HEX);
  });

  it('handles nprofile', () => {
    const nprofile = nprofileEncode(TEST_PUBKEY_HEX, ['wss://relay.damus.io']);
    assert.strictEqual(normalizeToHex(nprofile), TEST_PUBKEY_HEX);
  });

  it('returns null for invalid input', () => {
    assert.strictEqual(normalizeToHex(''), null);
    assert.strictEqual(normalizeToHex(null as any), null);
    assert.strictEqual(normalizeToHex('not-a-key'), null);
    assert.strictEqual(normalizeToHex('abc'), null);
  });
});

describe('known npub conversion', () => {
  it('known npub decodes to expected hex', () => {
    // Encode a known hex to npub, then decode
    const hex = '0000000000000000000000000000000000000000000000000000000000000001';
    const npub = npubEncode(hex);
    assert.strictEqual(npubDecode(npub), hex);
  });
});
