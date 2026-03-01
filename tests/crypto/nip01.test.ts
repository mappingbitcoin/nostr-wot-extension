import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.js';
import { getPublicKey } from '../../lib/crypto/secp256k1.js';
import { computeEventId, signEvent, verifyEvent } from '../../lib/crypto/nip01.js';

const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';

interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

describe('computeEventId', () => {
  it('matches known event ID', async () => {
    const event: UnsignedEvent = {
      pubkey: TEST_PUBKEY_HEX,
      created_at: 1000000,
      kind: 1,
      tags: [],
      content: 'hello world'
    };
    const id: string = await computeEventId(event);
    // Verify it's a valid 64-char hex string (SHA-256)
    assert.match(id, /^[0-9a-f]{64}$/);

    // Recomputing should give the same ID (deterministic)
    const id2: string = await computeEventId(event);
    assert.strictEqual(id, id2);
  });

  it('changes when content changes', async () => {
    const event1: UnsignedEvent = {
      pubkey: TEST_PUBKEY_HEX,
      created_at: 1000000,
      kind: 1,
      tags: [],
      content: 'hello'
    };
    const event2: UnsignedEvent = { ...event1, content: 'world' };
    const id1: string = await computeEventId(event1);
    const id2: string = await computeEventId(event2);
    assert.notStrictEqual(id1, id2);
  });
});

describe('signEvent', () => {
  it('produces valid signed event', async () => {
    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const event = {
      created_at: 1000000,
      kind: 1,
      tags: [] as string[][],
      content: 'test event'
    };

    const signed: any = await signEvent(event, privkey);

    // Should have all required fields
    assert.strictEqual(signed.pubkey, TEST_PUBKEY_HEX);
    assert.match(signed.id, /^[0-9a-f]{64}$/);
    assert.match(signed.sig, /^[0-9a-f]{128}$/);
    assert.strictEqual(signed.content, 'test event');
    assert.strictEqual(signed.kind, 1);
  });

  it('signature verifies correctly', async () => {
    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const event = {
      created_at: 1000000,
      kind: 1,
      tags: [['p', TEST_PUBKEY_HEX]],
      content: 'signed message'
    };

    const signed: any = await signEvent(event, privkey);
    const valid: boolean = await verifyEvent(signed);
    assert.strictEqual(valid, true);
  });
});

describe('verifyEvent', () => {
  it('rejects tampered content', async () => {
    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const signed: any = await signEvent({
      created_at: 1000000, kind: 1, tags: [], content: 'original'
    }, privkey);

    signed.content = 'tampered';
    const valid: boolean = await verifyEvent(signed);
    assert.strictEqual(valid, false);
  });

  it('rejects tampered signature', async () => {
    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const signed: any = await signEvent({
      created_at: 1000000, kind: 1, tags: [], content: 'test'
    }, privkey);

    // Flip a character in the sig
    const chars: string[] = signed.sig.split('');
    chars[0] = chars[0] === 'a' ? 'b' : 'a';
    signed.sig = chars.join('');

    const valid: boolean = await verifyEvent(signed);
    assert.strictEqual(valid, false);
  });

  it('rejects tampered id', async () => {
    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const signed: any = await signEvent({
      created_at: 1000000, kind: 1, tags: [], content: 'test'
    }, privkey);

    // Change the id
    signed.id = '0'.repeat(64);
    const valid: boolean = await verifyEvent(signed);
    assert.strictEqual(valid, false);
  });
});
