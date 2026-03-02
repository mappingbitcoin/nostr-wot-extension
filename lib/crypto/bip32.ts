/**
 * BIP-32 — Hierarchical Deterministic Key Derivation
 *
 * Thin wrapper over @scure/bip32 HDKey. Keeps async signatures for backward compatibility.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki — BIP-32
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md — NIP-06
 *
 * @module lib/crypto/bip32
 */

import { HDKey } from '@scure/bip32';

export const NIP06_PATH: string = "m/44'/1237'/0'/0/0";

export async function derivePath(seed: Uint8Array, path: string): Promise<Uint8Array> {
  const master = HDKey.fromMasterSeed(seed);
  try {
    const derived = master.derive(path);
    try {
      const key = derived.privateKey;
      if (!key) throw new Error('Derivation failed');
      return Uint8Array.from(key);
    } finally {
      derived.wipePrivateData();
    }
  } finally {
    master.wipePrivateData();
  }
}

export async function masterKeyFromSeed(seed: Uint8Array): Promise<{ privateKey: Uint8Array; chainCode: Uint8Array }> {
  const master = HDKey.fromMasterSeed(seed);
  try {
    return {
      privateKey: Uint8Array.from(master.privateKey!),
      chainCode: Uint8Array.from(master.chainCode!)
    };
  } finally {
    master.wipePrivateData();
  }
}
