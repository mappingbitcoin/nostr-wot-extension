/**
 * Lightweight BOLT11 invoice decoder
 *
 * Extracts amount, description, and expiry from Lightning invoices.
 * Uses the existing bech32 infrastructure from @scure/base.
 *
 * @see https://github.com/lightning/bolts/blob/master/11-payment-encoding.md
 *
 * @module lib/wallet/bolt11
 */

import { bech32Decode, convertBits } from '../crypto/bech32.ts';

// ── BOLT11 tagged field types (5-bit values) ──
// 'p' → 1: payment hash
// 'd' → 13: description (short)
// 'h' → 23: description hash (for long descriptions)
// 'x' → 6: expiry in seconds
// 'n' → 19: payee node pubkey

const TAG_PAYMENT_HASH = 1;
const TAG_DESCRIPTION = 13;
const TAG_EXPIRY = 6;

export interface DecodedInvoice {
  amountSats: number | null;
  description: string | null;
  expiry: number;           // seconds, default 3600
  paymentHash: string | null;
  network: string;          // 'bc' (mainnet), 'tb' (testnet), 'bcrt' (regtest)
  timestamp: number;
}

// ── Amount multipliers → sats ──
// 1 BTC = 100_000_000 sats
const MULTIPLIERS: Record<string, number> = {
  m: 100_000,      // milli-BTC
  u: 100,          // micro-BTC
  n: 0.1,          // nano-BTC
  p: 0.0001,       // pico-BTC
};

/**
 * Parse the amount from the BOLT11 HRP.
 * HRP format: ln{network}{amount}{multiplier}
 * Examples: lnbc1m, lnbc2500u, lnbc100n, lnbc (no amount)
 */
function parseAmount(hrp: string): { amountSats: number | null; network: string } {
  // Strip 'ln' prefix
  const afterLn = hrp.slice(2);

  // Detect network prefix
  let network: string;
  let rest: string;
  if (afterLn.startsWith('bcrt')) {
    network = 'bcrt';
    rest = afterLn.slice(4);
  } else if (afterLn.startsWith('bc')) {
    network = 'bc';
    rest = afterLn.slice(2);
  } else if (afterLn.startsWith('tb')) {
    network = 'tb';
    rest = afterLn.slice(2);
  } else {
    network = afterLn.slice(0, 2);
    rest = afterLn.slice(2);
  }

  if (!rest) return { amountSats: null, network };

  // Last char might be a multiplier
  const lastChar = rest[rest.length - 1];
  const multiplier = MULTIPLIERS[lastChar];

  if (multiplier !== undefined) {
    const num = parseFloat(rest.slice(0, -1));
    if (isNaN(num)) return { amountSats: null, network };
    return { amountSats: Math.round(num * multiplier), network };
  }

  // No multiplier — amount is in BTC
  const num = parseFloat(rest);
  if (isNaN(num)) return { amountSats: null, network };
  return { amountSats: Math.round(num * 100_000_000), network };
}

/**
 * Read an integer from 5-bit words (big-endian).
 */
function wordsToInt(words: number[]): number {
  let val = 0;
  for (const w of words) {
    val = val * 32 + w;
  }
  return val;
}

/**
 * Convert 5-bit words to a UTF-8 string.
 */
function wordsToUtf8(words: number[]): string {
  const bytes = convertBits(words, 5, 8, false);
  if (!bytes) return '';
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Convert 5-bit words to hex string.
 */
function wordsToHex(words: number[]): string {
  const bytes = convertBits(words, 5, 8, false);
  if (!bytes) return '';
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Decode a BOLT11 Lightning invoice string.
 * Returns null if the invoice is invalid or not a Lightning invoice.
 */
export function decodeBolt11(invoice: string): DecodedInvoice | null {
  const lower = invoice.trim().toLowerCase();
  if (!lower.startsWith('lnbc') && !lower.startsWith('lntb') && !lower.startsWith('lnbcrt')) {
    return null;
  }

  const decoded = bech32Decode(lower);
  if (!decoded) return null;

  const { amountSats, network } = parseAmount(decoded.hrp);
  const words = decoded.data;

  // First 7 bytes = 35 five-bit words = timestamp
  if (words.length < 35) return null;
  const timestamp = wordsToInt(words.slice(0, 7));

  // Parse tagged fields (after timestamp, before signature)
  // Signature = last 104 five-bit words (65 bytes: 64 sig + 1 recovery)
  const dataEnd = words.length - 104;
  let i = 7;

  let description: string | null = null;
  let expiry = 3600; // default
  let paymentHash: string | null = null;

  while (i < dataEnd) {
    if (i + 3 > dataEnd) break;

    const tag = words[i];
    const dataLength = words[i + 1] * 32 + words[i + 2];
    i += 3;

    if (i + dataLength > dataEnd) break;

    const fieldWords = words.slice(i, i + dataLength);

    switch (tag) {
      case TAG_DESCRIPTION:
        description = wordsToUtf8(fieldWords);
        break;
      case TAG_EXPIRY:
        expiry = wordsToInt(fieldWords);
        break;
      case TAG_PAYMENT_HASH:
        paymentHash = wordsToHex(fieldWords);
        break;
    }

    i += dataLength;
  }

  return { amountSats, description, expiry, paymentHash, network, timestamp };
}
