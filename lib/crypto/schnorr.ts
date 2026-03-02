/**
 * BIP-340 Schnorr Signatures — Thin wrapper over @noble/curves
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki — BIP-340
 *
 * @module lib/crypto/schnorr
 */

import { schnorr } from '@noble/curves/secp256k1.js';

export async function schnorrSign(msg: Uint8Array, privkey: Uint8Array, auxRand?: Uint8Array): Promise<Uint8Array> {
  if (msg.length !== 32) throw new Error('Message must be 32 bytes');
  if (privkey.length !== 32) throw new Error('Private key must be 32 bytes');
  return schnorr.sign(msg, privkey, auxRand);
}

export async function schnorrVerify(msg: Uint8Array, pubkey: Uint8Array, sig: Uint8Array): Promise<boolean> {
  try {
    if (msg.length !== 32 || pubkey.length !== 32 || sig.length !== 64) return false;
    return schnorr.verify(sig, msg, pubkey);
  } catch {
    return false;
  }
}
