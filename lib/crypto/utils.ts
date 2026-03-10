/**
 * Cryptographic Utility Functions
 *
 * Re-exports from @noble/hashes and provides helpers used throughout crypto modules.
 *
 * @module lib/crypto/utils
 */

import { bytesToHex as _bytesToHex, hexToBytes as _hexToBytes, concatBytes as _concatBytes } from '@noble/hashes/utils.js';
import { sha256 as _sha256 } from '@noble/hashes/sha2.js';

export const hexToBytes: (hex: string) => Uint8Array = _hexToBytes;
export const bytesToHex: (bytes: Uint8Array) => string = _bytesToHex;
export const concatBytes: (...arrays: Uint8Array[]) => Uint8Array = _concatBytes;

export function randomBytes(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len));
}

export function randomHex(byteLength: number): string {
  return bytesToHex(randomBytes(byteLength));
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return _sha256(data);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function writeU32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (n >>> 24) & 0xff;
  buf[1] = (n >>> 16) & 0xff;
  buf[2] = (n >>> 8) & 0xff;
  buf[3] = n & 0xff;
  return buf;
}

export function readU32BE(buf: Uint8Array, offset: number = 0): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

// ── Base64 helpers ──

export function arrayToBase64(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

export function base64ToArray(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
