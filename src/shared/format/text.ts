import { npubEncode } from '@lib/crypto/bech32.ts';

export function truncateNpub(pubkey: string): string {
  try {
    const npub = npubEncode(pubkey);
    return npub.slice(0, 12) + '...' + npub.slice(-4);
  } catch {
    return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
  }
}

export function getInitial(name: string | null | undefined): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

export function truncate(s: string | null | undefined, maxLen: number): string {
  return s && s.length > maxLen ? s.slice(0, maxLen) + '...' : (s || '');
}
