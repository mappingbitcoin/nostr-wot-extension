/**
 * NIP-04 — Legacy Encrypted Direct Messages (AES-256-CBC)
 *
 * Uses noble secp256k1 for ECDH, Web Crypto for AES-256-CBC.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/04.md — NIP-04
 *
 * @module lib/crypto/nip04
 */

import { ecdh } from './secp256k1.ts';
import { arrayToBase64, base64ToArray } from './utils.ts';

export async function nip04Encrypt(plaintext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string> {
  const sharedKey = ecdh(privkey, theirPubkey);

  try {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const enc = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw', sharedKey as BufferSource, { name: 'AES-CBC' }, false, ['encrypt']
    );

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv },
      key,
      enc.encode(plaintext)
    );

    const ctBase64 = arrayToBase64(new Uint8Array(ciphertext));
    const ivBase64 = arrayToBase64(iv);

    return `${ctBase64}?iv=${ivBase64}`;
  } finally {
    sharedKey.fill(0);
  }
}

export async function nip04Decrypt(data: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string> {
  const [ctBase64, ivPart] = data.split('?iv=');
  if (!ctBase64 || !ivPart) throw new Error('Invalid NIP-04 data format');

  const ciphertext = base64ToArray(ctBase64);
  const iv = base64ToArray(ivPart);

  const sharedKey = ecdh(privkey, theirPubkey);

  try {
    const key = await crypto.subtle.importKey(
      'raw', sharedKey as BufferSource, { name: 'AES-CBC' }, false, ['decrypt']
    );

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: iv as BufferSource },
        key,
        ciphertext as BufferSource
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new Error('Decryption failed');
    }
  } finally {
    sharedKey.fill(0);
  }
}
