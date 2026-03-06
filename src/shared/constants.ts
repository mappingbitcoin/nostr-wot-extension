export interface SensitivityPreset {
  labelKey: string;
  descKey: string;
  weights: Record<number, number>;
  pathBonus: Record<number, number>;
  maxPathBonus: number;
}

export const SENSITIVITY_PRESETS: readonly SensitivityPreset[] = [
  { labelKey: 'scoring.strict', descKey: 'scoring.strictDesc', weights: { 2: 0.3, 3: 0.1, 4: 0.05 }, pathBonus: { 2: 0.1, 3: 0.05, 4: 0.02 }, maxPathBonus: 0.3 },
  { labelKey: 'scoring.conservative', descKey: 'scoring.conservativeDesc', weights: { 2: 0.4, 3: 0.15, 4: 0.08 }, pathBonus: { 2: 0.12, 3: 0.08, 4: 0.03 }, maxPathBonus: 0.4 },
  { labelKey: 'scoring.balanced', descKey: 'scoring.balancedDesc', weights: { 2: 0.5, 3: 0.25, 4: 0.1 }, pathBonus: { 2: 0.15, 3: 0.1, 4: 0.05 }, maxPathBonus: 0.5 },
  { labelKey: 'scoring.open', descKey: 'scoring.openDesc', weights: { 2: 0.6, 3: 0.35, 4: 0.15 }, pathBonus: { 2: 0.2, 3: 0.15, 4: 0.08 }, maxPathBonus: 0.6 },
  { labelKey: 'scoring.veryOpen', descKey: 'scoring.veryOpenDesc', weights: { 2: 0.75, 3: 0.5, 4: 0.25 }, pathBonus: { 2: 0.25, 3: 0.2, 4: 0.1 }, maxPathBonus: 0.7 },
] as const;

export const KNOWN_ORACLES: readonly string[] = ['https://wot-oracle.mappingbitcoin.com'] as const;

export const DEFAULT_RELAYS = 'wss://relay.damus.io,wss://nos.lol,wss://nostr-01.yakihonne.com' as const;

export const KIND_LABELS: Record<number, string> = {
  0: 'Profile Metadata',
  1: 'Short Note',
  2: 'Relay Recommendation',
  3: 'Contact List',
  4: 'Encrypted DM (NIP-04)',
  5: 'Event Deletion',
  6: 'Repost',
  7: 'Reaction',
  8: 'Badge Award',
  9: 'Chat Message',
  10: 'Group Chat',
  13: 'Sealed Message',
  40: 'Channel Create',
  41: 'Channel Metadata',
  42: 'Channel Message',
  43: 'Channel Hide',
  44: 'Channel Mute',
  1059: 'Gift Wrap (Private DM)',
  1063: 'File Metadata',
  1111: 'Comment',
  1984: 'Report',
  9734: 'Zap Request',
  9735: 'Zap Receipt',
  10000: 'Mute List',
  10001: 'Pin List',
  10002: 'Relay List',
  10006: 'Bookmark List',
  10007: 'Pinned Notes',
  10015: 'Interest Set',
  10030: 'Emoji Set',
  22242: 'Relay Auth',
  24242: 'Blossom Auth',
  27235: 'HTTP Auth',
  30000: 'Profile Badges',
  30003: 'Bookmark Set',
  30008: 'Profile Badges',
  30009: 'Badge Definition',
  30023: 'Long-form Article',
  30024: 'Draft Long-form',
  30078: 'App-specific Data',
  30311: 'Live Event',
  30402: 'Classified Listing',
} as const;

export interface AutoLockOption {
  ms: number;
  labelKey: string;
}

export const AUTO_LOCK_OPTIONS: readonly AutoLockOption[] = [
  { ms: 300000, labelKey: 'security.5min' },
  { ms: 900000, labelKey: 'security.15min' },
  { ms: 3600000, labelKey: 'security.1hr' },
  { ms: 0, labelKey: 'security.never' },
] as const;
