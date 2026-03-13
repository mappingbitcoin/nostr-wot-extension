/**
 * secp256k1 — Thin wrapper over @noble/curves
 *
 * Provides the same API surface used by other modules (getPublicKey, ecdh,
 * isValidPrivateKey, liftX, N) via noble's audited implementation.
 *
 * @module lib/crypto/secp256k1
 */

import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from './utils.ts';

export const N: bigint = secp256k1.Point.Fn.ORDER;
const P: bigint = secp256k1.Point.Fp.ORDER;

export function getPublicKey(privkey: Uint8Array): Uint8Array {
  return schnorr.getPublicKey(privkey);
}

export function isValidPrivateKey(privkey: Uint8Array): boolean {
  if (!(privkey instanceof Uint8Array) || privkey.length !== 32) return false;
  try {
    schnorr.getPublicKey(privkey);
    return true;
  } catch {
    return false;
  }
}

export function ecdh(privkey: Uint8Array, theirPubkey: Uint8Array): Uint8Array {
  if (theirPubkey.length !== 32) throw new Error('Public key must be 32 bytes');
  const prefixed = new Uint8Array(33);
  prefixed[0] = 0x02;
  prefixed.set(theirPubkey, 1);
  const full = secp256k1.getSharedSecret(privkey, prefixed);
  const result = full.slice(1, 33);
  full.fill(0);
  return result;
}

export function liftX(xBytes: Uint8Array): { x: bigint; y: bigint } {
  const point = secp256k1.Point.fromHex('02' + bytesToHex(xBytes));
  const aff = point.toAffine();
  let y = aff.y;
  if (y & 1n) y = P - y;
  return { x: aff.x, y };
}
