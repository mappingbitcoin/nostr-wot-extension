/**
 * BIP-39 — Mnemonic Seed Phrase Generation and Seed Derivation
 *
 * Thin wrapper over @scure/bip39. Keeps async signatures for backward compatibility.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki — BIP-39
 *
 * @module lib/crypto/bip39
 */

import {
  generateMnemonic as _gen,
  mnemonicToSeedSync as _seedSync,
  validateMnemonic as _validate,
  entropyToMnemonic as _etm
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export async function generateMnemonic(strength: number = 128): Promise<string> {
  return _gen(wordlist, strength);
}

export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  return _etm(entropy, wordlist);
}

export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  return _validate(mnemonic, wordlist);
}

export async function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
  return _seedSync(mnemonic, passphrase);
}
