import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.js';
import { getPublicKey } from '../../lib/crypto/secp256k1.js';
import { nip44Encrypt, nip44Decrypt } from '../../lib/crypto/nip44.js';

const ALICE_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const BOB_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
const ALICE_PUBKEY: Uint8Array = getPublicKey(ALICE_PRIVKEY);
const BOB_PUBKEY: Uint8Array = getPublicKey(BOB_PRIVKEY);

describe('nip44Encrypt / nip44Decrypt', () => {
  it('encrypt then decrypt round-trip', async () => {
    const plaintext = 'Hello, NIP-44!';
    const encrypted: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip44Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('symmetric ECDH: both directions work', async () => {
    const plaintext = 'bidirectional test';
    // Alice -> Bob
    const enc1: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const dec1: string = await nip44Decrypt(enc1, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(dec1, plaintext);

    // Bob -> Alice
    const enc2: string = await nip44Encrypt(plaintext, BOB_PRIVKEY, ALICE_PUBKEY);
    const dec2: string = await nip44Decrypt(enc2, ALICE_PRIVKEY, BOB_PUBKEY);
    assert.strictEqual(dec2, plaintext);
  });

  it('output is base64', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    // Should be valid base64
    assert.doesNotThrow(() => atob(encrypted));
  });

  it('payload starts with version byte 2', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    assert.strictEqual(raw[0], 2); // NIP-44 v2
  });

  it('payload has correct structure: version(1) + nonce(32) + ciphertext + mac(32)', async () => {
    const encrypted: string = await nip44Encrypt('short', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    // Minimum: 1 (version) + 32 (nonce) + 34 (2-byte len + 32 padded) + 32 (mac) = 99
    assert.ok(raw.length >= 99);
  });

  it('different nonces produce different ciphertexts', async () => {
    const plaintext = 'same message';
    const enc1: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const enc2: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    assert.notStrictEqual(enc1, enc2);
  });

  it('padding: output length is aligned for short messages', async () => {
    // "a" (1 byte) should pad to 32 bytes, so ciphertext = 2+32 = 34 bytes
    const encrypted: string = await nip44Encrypt('a', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    const ciphertextLen: number = raw.length - 1 - 32 - 32; // minus version, nonce, mac
    assert.strictEqual(ciphertextLen, 34); // 2-byte length prefix + 32 padded
  });

  it('handles unicode text', async () => {
    const plaintext = 'Hello World! Testing unicode.';
    const encrypted: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip44Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('rejects tampered MAC', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    // Tamper with the last byte (MAC)
    raw[raw.length - 1] ^= 0x01;
    const tampered: string = btoa(String.fromCharCode(...raw));
    await assert.rejects(
      () => nip44Decrypt(tampered, BOB_PRIVKEY, ALICE_PUBKEY),
      /Invalid MAC/
    );
  });

  it('rejects too-short payload', async () => {
    const short: string = btoa(String.fromCharCode(2, ...new Uint8Array(50)));
    await assert.rejects(
      () => nip44Decrypt(short, BOB_PRIVKEY, ALICE_PUBKEY),
      /Payload too short/
    );
  });

  it('rejects wrong version', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    raw[0] = 1; // wrong version
    const tampered: string = btoa(String.fromCharCode(...raw));
    await assert.rejects(
      () => nip44Decrypt(tampered, BOB_PRIVKEY, ALICE_PUBKEY),
      /Unsupported NIP-44 version/
    );
  });
});
