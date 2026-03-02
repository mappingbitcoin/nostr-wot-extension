/**
 * Multi-Account Manager
 *
 * Creates, imports, and manages Nostr identity accounts of various types:
 *   - generated: New keys from BIP-39 mnemonic via NIP-06 derivation path
 *   - nsec: Imported private key (nsec bech32 or hex)
 *   - npub: Read-only public key (no signing capability)
 *   - nip46: Remote signer via Nostr Connect (bunker:// URL)
 *   - external: Delegates to another NIP-07 extension
 *
 * All account types are stored in the encrypted vault. Only the active account's
 * pubkey is synced to the WoT configuration for trust graph queries.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md -- NIP-06: Key derivation from mnemonic (m/44'/1237'/0'/0/0)
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md -- NIP-19: bech32 entities (nsec, npub)
 * @see https://github.com/nostr-protocol/nips/blob/master/46.md -- NIP-46: Nostr Connect (remote signing)
 *
 * @module lib/accounts
 */

import type { Account, AccountType, Nip46Config } from './types.ts';
import { getPublicKey } from './crypto/secp256k1.js';
import { bytesToHex, hexToBytes } from './crypto/utils.js';
import { nsecDecode, npubDecode } from './crypto/bech32.js';
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from './crypto/bip39.js';
import { derivePath, NIP06_PATH } from './crypto/bip32.js';

function generateId(): string {
  const arr = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new account from a mnemonic (NIP-06 derivation)
 * @param mnemonic - 12 or 24 word mnemonic
 * @param name - Account display name
 * @returns Account object
 */
export async function createFromMnemonic(mnemonic: string, name: string = 'Main'): Promise<Account> {
  const valid = await validateMnemonic(mnemonic);
  if (!valid) throw new Error('Invalid mnemonic');

  const seed = await mnemonicToSeed(mnemonic);
  const privkey = await derivePath(seed, NIP06_PATH);
  const pubkey = getPublicKey(privkey);

  return {
    id: generateId(),
    name,
    type: 'generated',
    pubkey: bytesToHex(pubkey),
    privkey: bytesToHex(privkey),
    mnemonic,
    nip46Config: null,
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000),
    derivationIndex: 0
  };
}

/**
 * Create a sub-account from an existing mnemonic at a specific HD derivation index.
 * Derives from m/44'/1237'/0'/0/{index} per NIP-06.
 * @param mnemonic - existing 12 or 24 word mnemonic
 * @param index - derivation index (0 = first account, 1 = second, etc.)
 * @param name - Account display name
 * @returns Account object with derivationIndex set
 */
export async function createFromMnemonicAtIndex(mnemonic: string, index: number, name?: string): Promise<Account> {
  const valid = await validateMnemonic(mnemonic);
  if (!valid) throw new Error('Invalid mnemonic');

  const seed = await mnemonicToSeed(mnemonic);
  const path = `m/44'/1237'/0'/0/${index}`;
  const privkey = await derivePath(seed, path);
  const pubkey = getPublicKey(privkey);

  return {
    id: generateId(),
    name: name || `Account ${index + 1}`,
    type: 'generated',
    pubkey: bytesToHex(pubkey),
    privkey: bytesToHex(privkey),
    mnemonic,
    nip46Config: null,
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000),
    derivationIndex: index
  };
}

/**
 * Generate a new mnemonic and create an account
 * @param name
 * @returns Object with account and mnemonic
 */
export async function generateNewAccount(name: string = 'Main'): Promise<{ account: Account; mnemonic: string }> {
  const mnemonic = await generateMnemonic(128); // 12 words
  const account = await createFromMnemonic(mnemonic, name);
  return { account, mnemonic };
}

/**
 * Import only the first derived key from a mnemonic (no mnemonic stored).
 * Used when a main seed already exists and we only want the key, not the seed.
 * @param mnemonic - 12 or 24 word mnemonic
 * @param name - Account display name
 * @returns Account object with type 'nsec' (no mnemonic field)
 */
export async function importFromMnemonicDerived(mnemonic: string, name: string = 'Imported'): Promise<Account> {
  const valid = await validateMnemonic(mnemonic);
  if (!valid) throw new Error('Invalid mnemonic');

  const seed = await mnemonicToSeed(mnemonic);
  const privkey = await derivePath(seed, NIP06_PATH);
  const pubkey = getPublicKey(privkey);

  return {
    id: generateId(),
    name,
    type: 'nsec',
    pubkey: bytesToHex(pubkey),
    privkey: bytesToHex(privkey),
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Import an account from an nsec or hex private key
 * @param input - nsec1... or 64-char hex
 * @param name
 * @returns Account object
 */
export async function importNsec(input: string, name: string = 'Imported'): Promise<Account> {
  let privkeyHex: string;

  if (input.startsWith('nsec1')) {
    privkeyHex = nsecDecode(input);
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    privkeyHex = input.toLowerCase();
  } else {
    throw new Error('Invalid nsec or hex private key');
  }

  const privkeyBytes = hexToBytes(privkeyHex);
  const pubkey = getPublicKey(privkeyBytes);

  return {
    id: generateId(),
    name,
    type: 'nsec',
    pubkey: bytesToHex(pubkey),
    privkey: privkeyHex,
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Import a read-only account from an npub or hex pubkey
 * @param input - npub1... or 64-char hex
 * @param name
 * @returns Account object
 */
export function importNpub(input: string, name: string = 'Watch-only'): Account {
  let pubkeyHex: string;

  if (input.startsWith('npub1')) {
    pubkeyHex = npubDecode(input);
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    pubkeyHex = input.toLowerCase();
  } else {
    throw new Error('Invalid npub or hex public key');
  }

  return {
    id: generateId(),
    name,
    type: 'npub',
    pubkey: pubkeyHex,
    privkey: null,
    mnemonic: null,
    nip46Config: null,
    readOnly: true,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Create a NIP-46 (Nostr Connect) account stub
 * @param bunkerUrl - bunker://pubkey?relay=...&secret=...
 * @param name
 * @returns Account object
 */
export function connectNip46(bunkerUrl: string, name: string = 'Bunker'): Account {
  // Parse bunker URL
  const url = new URL(bunkerUrl);
  const pubkey = url.hostname || url.pathname.replace('//', '');
  const relay = url.searchParams.get('relay');
  const secret = url.searchParams.get('secret');

  if (!pubkey || pubkey.length !== 64) {
    throw new Error('Invalid bunker URL: missing pubkey');
  }

  return {
    id: generateId(),
    name,
    type: 'nip46',
    pubkey,
    privkey: null,
    mnemonic: null,
    nip46Config: { bunkerUrl, relay, secret },
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Create a NIP-46 account from a nostrconnect:// QR flow
 * @param signerPubkey - hex pubkey of the remote signer
 * @param relay - relay URL used for communication
 * @param localPrivkey - hex ephemeral private key (for reconnection)
 * @param localPubkey - hex ephemeral public key
 * @param name
 * @returns Account object
 */
export function connectNostrConnect(signerPubkey: string, relay: string, localPrivkey: string, localPubkey: string, name: string = 'Nostr Connect'): Account {
  return {
    id: generateId(),
    name,
    type: 'nip46',
    pubkey: signerPubkey,
    privkey: null,
    mnemonic: null,
    nip46Config: {
      bunkerUrl: `bunker://${signerPubkey}?relay=${encodeURIComponent(relay)}`,
      relay,
      secret: null,
      localPrivkey,
      localPubkey,
    },
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}
