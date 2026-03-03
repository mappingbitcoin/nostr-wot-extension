/**
 * NIP-44 v2 — Versioned Encryption (ChaCha20 + HMAC-SHA256)
 *
 * Uses noble ECDH, @noble/hashes for HMAC/HKDF, @noble/ciphers for ChaCha20.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/44.md — NIP-44
 *
 * @module lib/crypto/nip44
 */

import { extract as hkdfExtract, expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { concatBytes, constantTimeEqual, arrayToBase64, base64ToArray } from './utils.ts';
import { ecdh } from './secp256k1.ts';

const NIP44_VERSION: number = 2;

// ── NIP-44 padding ──

function calcPaddedLen(unpaddedLen: number): number {
  if (unpaddedLen <= 0) throw new Error('Invalid length');
  if (unpaddedLen <= 32) return 32;
  const nextPow2 = 1 << (32 - Math.clz32(unpaddedLen - 1));
  const chunk = Math.max(32, nextPow2 / 8);
  return chunk * Math.ceil(unpaddedLen / chunk);
}

function pad(plaintext: string): Uint8Array {
  const unpadded = new TextEncoder().encode(plaintext);
  const unpaddedLen = unpadded.length;
  if (unpaddedLen < 1 || unpaddedLen > 65535) {
    throw new Error('Plaintext too long or empty');
  }

  const paddedLen = calcPaddedLen(unpaddedLen);
  const padded = new Uint8Array(2 + paddedLen);
  padded[0] = (unpaddedLen >> 8) & 0xff;
  padded[1] = unpaddedLen & 0xff;
  padded.set(unpadded, 2);
  return padded;
}

function unpad(padded: Uint8Array): string {
  const unpaddedLen = (padded[0] << 8) | padded[1];
  if (unpaddedLen < 1 || unpaddedLen > padded.length - 2) {
    throw new Error('Invalid padding');
  }
  const unpadded = padded.slice(2, 2 + unpaddedLen);
  return new TextDecoder().decode(unpadded);
}

// ── NIP-44 conversation key ──

function getConversationKey(privkey: Uint8Array, theirPubkey: Uint8Array): Uint8Array {
  const sharedX = ecdh(privkey, theirPubkey);
  try {
    const salt = new TextEncoder().encode('nip44-v2');
    return hkdfExtract(sha256, sharedX, salt);
  } finally {
    sharedX.fill(0);
  }
}

// ── NIP-44 message keys ──

interface MessageKeys {
  chachaKey: Uint8Array;
  chaChaNonce: Uint8Array;
  hmacKey: Uint8Array;
}

function getMessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): MessageKeys {
  const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
  return {
    chachaKey: keys.slice(0, 32),
    chaChaNonce: keys.slice(32, 44),
    hmacKey: keys.slice(44, 76)
  };
}

// ── Public API ──

export async function nip44Encrypt(plaintext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string> {
  const conversationKey = getConversationKey(privkey, theirPubkey);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const { chachaKey, chaChaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);

  try {
    const padded = pad(plaintext);
    const ciphertext = chacha20(chachaKey, chaChaNonce, padded);

    // HMAC covers nonce || ciphertext (NOT the version byte) per NIP-44 spec
    const hmacInput = concatBytes(nonce, ciphertext);
    const mac = hmac(sha256, hmacKey, hmacInput);

    const final = concatBytes(
      new Uint8Array([NIP44_VERSION]),
      nonce,
      ciphertext,
      mac
    );

    return arrayToBase64(final);
  } finally {
    conversationKey.fill(0);
    chachaKey.fill(0);
    chaChaNonce.fill(0);
    hmacKey.fill(0);
  }
}

export async function nip44Decrypt(data: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string> {
  const raw = base64ToArray(data);
  if (raw.length < 99) throw new Error('Payload too short');

  const version = raw[0];
  if (version !== NIP44_VERSION) throw new Error(`Unsupported NIP-44 version: ${version}`);

  const nonce = raw.slice(1, 33);
  const ciphertext = raw.slice(33, raw.length - 32);
  const mac = raw.slice(raw.length - 32);

  const conversationKey = getConversationKey(privkey, theirPubkey);
  const { chachaKey, chaChaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);

  try {
    // HMAC covers nonce || ciphertext (NOT the version byte) per NIP-44 spec
    const hmacInput = concatBytes(nonce, ciphertext);
    const expectedMac = hmac(sha256, hmacKey, hmacInput);
    if (!constantTimeEqual(mac, expectedMac)) {
      throw new Error('Invalid MAC');
    }

    const padded = chacha20(chachaKey, chaChaNonce, ciphertext);
    return unpad(padded);
  } finally {
    conversationKey.fill(0);
    chachaKey.fill(0);
    chaChaNonce.fill(0);
    hmacKey.fill(0);
  }
}
