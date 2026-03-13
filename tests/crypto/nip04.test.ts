import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes } from '../../lib/crypto/utils.ts';
import { getPublicKey } from '../../lib/crypto/secp256k1.ts';
import { nip04Encrypt, nip04Decrypt } from '../../lib/crypto/nip04.ts';

const ALICE_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const BOB_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
const ALICE_PUBKEY: Uint8Array = getPublicKey(ALICE_PRIVKEY);
const BOB_PUBKEY: Uint8Array = getPublicKey(BOB_PRIVKEY);

describe('nip04Encrypt / nip04Decrypt', () => {
  it('encrypt then decrypt round-trip returns original plaintext', async () => {
    const plaintext = 'Hello, Nostr!';
    const encrypted: string = await nip04Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip04Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('output format is base64?iv=base64', async () => {
    const encrypted: string = await nip04Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    assert.ok(encrypted.includes('?iv='));
    const [ct, ivPart] = encrypted.split('?iv=');
    // Both parts should be valid base64
    assert.doesNotThrow(() => atob(ct));
    assert.doesNotThrow(() => atob(ivPart));
  });

  it('different keys can decrypt with correct shared secret (symmetric ECDH)', async () => {
    // Alice encrypts to Bob, Bob decrypts from Alice
    const plaintext = 'symmetric ECDH test';
    const encrypted: string = await nip04Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip04Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);

    // Bob encrypts to Alice, Alice decrypts from Bob
    const encrypted2: string = await nip04Encrypt(plaintext, BOB_PRIVKEY, ALICE_PUBKEY);
    const decrypted2: string = await nip04Decrypt(encrypted2, ALICE_PRIVKEY, BOB_PUBKEY);
    assert.strictEqual(decrypted2, plaintext);
  });

  it('encrypts unicode correctly', async () => {
    const plaintext = 'Hello! Emoji test';
    const encrypted: string = await nip04Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip04Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('each encryption produces different ciphertext (random IV)', async () => {
    const plaintext = 'same message';
    const enc1: string = await nip04Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const enc2: string = await nip04Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    // Different random IVs should produce different ciphertexts
    assert.notStrictEqual(enc1, enc2);
  });

  it('rejects invalid format', async () => {
    await assert.rejects(
      () => nip04Decrypt('notbase64', BOB_PRIVKEY, ALICE_PUBKEY),
      /Invalid NIP-04 data format/
    );
  });
});
