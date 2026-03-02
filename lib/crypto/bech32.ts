/**
 * Bech32 / Bech32m Encoding and Decoding for Nostr
 *
 * Uses @scure/base for bech32 codec, keeps Nostr-specific TLV logic.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md — NIP-19
 *
 * @module lib/crypto/bech32
 */

import { bech32 as _bech32 } from '@scure/base';
import { hexToBytes, bytesToHex, concatBytes } from './utils.ts';

/**
 * Convert between bit groups
 */
export function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << to) - 1;

  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (to - bits)) & maxv);
    }
  } else {
    if (bits >= from) return null;
    if ((acc << (to - bits)) & maxv) return null;
  }

  return result;
}

/**
 * Encode data as bech32
 */
export function bech32Encode(hrp: string, data5bit: number[]): string {
  const words = new Uint8Array(data5bit);
  return _bech32.encode(hrp, words, 5000);
}

/**
 * Decode a bech32 string (tries bech32, no bech32m needed for Nostr NIP-19)
 */
export function bech32Decode(str: string): { hrp: string; data: number[] } | null {
  try {
    const decoded = _bech32.decode(str as `${string}1${string}`, 5000);
    return { hrp: decoded.prefix, data: Array.from(decoded.words) };
  } catch {
    return null;
  }
}

// ── Nostr-specific helpers ──

export function npubEncode(pubkey: string | Uint8Array): string {
  const bytes = typeof pubkey === 'string' ? hexToBytes(pubkey) : pubkey;
  if (bytes.length !== 32) throw new Error('Invalid pubkey length');
  const data = convertBits(Array.from(bytes), 8, 5, true);
  return bech32Encode('npub', data!);
}

export function npubDecode(npub: string): string {
  const decoded = bech32Decode(npub);
  if (!decoded || decoded.hrp !== 'npub') throw new Error('Invalid npub');
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes || bytes.length !== 32) throw new Error('Invalid npub data');
  return bytesToHex(new Uint8Array(bytes));
}

export function nsecEncode(privkey: string | Uint8Array): string {
  const bytes = typeof privkey === 'string' ? hexToBytes(privkey) : privkey;
  if (bytes.length !== 32) throw new Error('Invalid privkey length');
  const data = convertBits(Array.from(bytes), 8, 5, true);
  return bech32Encode('nsec', data!);
}

export function nsecDecode(nsec: string): string {
  const decoded = bech32Decode(nsec);
  if (!decoded || decoded.hrp !== 'nsec') throw new Error('Invalid nsec');
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes || bytes.length !== 32) throw new Error('Invalid nsec data');
  return bytesToHex(new Uint8Array(bytes));
}

export function nprofileEncode(pubkey: string, relays: string[] = []): string {
  const pubkeyBytes = hexToBytes(pubkey);
  const parts: Uint8Array[] = [new Uint8Array([0x00, 32]), pubkeyBytes];

  for (const relay of relays) {
    const relayBytes = new TextEncoder().encode(relay);
    parts.push(new Uint8Array([0x01, relayBytes.length]));
    parts.push(relayBytes);
  }

  const tlv = concatBytes(...parts);
  const data = convertBits(Array.from(tlv), 8, 5, true);
  return bech32Encode('nprofile', data!);
}

export function nprofileDecode(nprofile: string): { pubkey: string; relays: string[] } {
  const decoded = bech32Decode(nprofile);
  if (!decoded || decoded.hrp !== 'nprofile') throw new Error('Invalid nprofile');
  const bytes = convertBits(decoded.data, 5, 8, false);
  if (!bytes) throw new Error('Invalid nprofile data');

  let pubkey: string | null = null;
  const relays: string[] = [];
  let i = 0;
  const data = new Uint8Array(bytes);

  while (i < data.length) {
    const type = data[i];
    const len = data[i + 1];
    i += 2;

    if (i + len > data.length) throw new Error('TLV overflow');

    const value = data.slice(i, i + len);
    if (type === 0x00 && len === 32) {
      pubkey = bytesToHex(value);
    } else if (type === 0x01) {
      relays.push(new TextDecoder().decode(value));
    }
    i += len;
  }

  if (!pubkey) throw new Error('No pubkey in nprofile');
  return { pubkey, relays };
}

export function normalizeToHex(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  input = input.trim();

  if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase();

  if (input.startsWith('npub1')) {
    try { return npubDecode(input); } catch { return null; }
  }

  if (input.startsWith('nprofile1')) {
    try { return nprofileDecode(input).pubkey; } catch { return null; }
  }

  return null;
}
