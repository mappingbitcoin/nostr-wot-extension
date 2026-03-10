/**
 * Shared domain types for the Nostr WoT Extension
 * @module lib/types
 */

import type { WalletConfig } from './wallet/types.ts';

// ── Nostr Events ──

export interface UnsignedEvent {
  pubkey?: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

// ── Accounts ──

export type AccountType = 'generated' | 'nsec' | 'npub' | 'nip46' | 'external';

export interface Nip46Config {
  bunkerUrl: string;
  relay: string | null;
  secret: string | null;
  localPrivkey?: string;
  localPubkey?: string;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  pubkey: string;
  privkey: string | null;
  mnemonic: string | null;
  nip46Config: Nip46Config | null;
  readOnly: boolean;
  createdAt: number;
  derivationIndex?: number;
  walletConfig?: WalletConfig;
}

/** Account without private key — safe to expose */
export type SafeAccount = Omit<Account, 'privkey' | 'mnemonic' | 'walletConfig'>;

/** Account without private key but with walletConfig — for background wallet handlers */
export type SafeAccountWithWallet = Omit<Account, 'privkey' | 'mnemonic'>;

/** Account with private key as Uint8Array — used in vault memory only */
export interface MemoryAccount extends Omit<Account, 'privkey' | 'mnemonic'> {
  privkeyBytes: Uint8Array | null;  // zeroed on lock
  mnemonicBytes: Uint8Array | null; // zeroed on lock
}

/** Vault payload with Uint8Array keys — in-memory only */
export interface MemoryVaultPayload {
  accounts: MemoryAccount[];
  activeAccountId: string | null;
}

// ── Vault ──

export interface VaultPayload {
  accounts: Account[];
  activeAccountId: string | null;
}

// ── Permissions ──

export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** Per-domain permission bucket: { permKey: decision } */
export type PermissionBucket = Record<string, PermissionDecision>;

/** Per-domain permissions: { bucketId: { permKey: decision } } */
export type DomainPermissions = Record<string, PermissionBucket>;

/** Full permission storage: { domain: { bucketId: { permKey: decision } } } */
export type PermissionMap = Record<string, DomainPermissions>;

// ── Signer ──

export interface PendingRequest {
  id: string;
  type: string;
  origin: string;
  pubkey?: string;
  event?: Partial<UnsignedEvent>;
  theirPubkey?: string;
  permKey?: string | null;
  eventKind?: number;
  needsPermission?: boolean;
  waitingForUnlock?: boolean;
  nip46InFlight?: boolean;
  accountId?: string | null;
  walletAmount?: number;
  timestamp: number;
}

export interface RequestDecision {
  allow: boolean;
  remember?: boolean;
  rememberKind?: boolean;
  reason?: string;
}

// ── Scoring ──

export interface ScoringConfig {
  distanceWeights: Record<number, number>;
  pathBonus: Record<number, number>;
  maxPathBonus: number;
}

// ── Storage / Graph ──

export interface StorageStats {
  nodes: number;
  edges: number;
  uniquePubkeys: number;
  lastSync: number | null;
  nodesPerDepth: Record<number, number> | null;
  syncDepth: number | null;
  dbSizeBytes: number;
}

export interface SyncResult {
  nodes: number;
  fetched: number;
  failed: number;
  nodesPerDepth: Record<number, number>;
  aborted?: boolean;
}

export interface SyncProgress {
  fetched: number;
  pending: number;
  currentDepth: number;
  maxDepth: number;
  nodesPerDepth: Record<number, number>;
  total: number;
  connectedRelays?: number;
  totalRelays?: number;
}

export interface DistanceInfo {
  hops: number;
  paths: number | null;
}

// ── i18n ──

export interface SupportedLanguage {
  code: string;
  name: string;
  native: string;
  flag: string;
  prompt: string;
}

// ── Relay / liveQuery ──

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#e'?: string[];
  '#p'?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

export type LiveEvent =
  | { type: 'event';     event: SignedEvent; source: 'local' | 'relay'; relay?: string }
  | { type: 'update';    event: SignedEvent; supersedes: string }
  | { type: 'delete';    eventId: string }
  | { type: 'eose';      relay: string }
  | { type: 'exhausted' };

export interface LiveQueryOptions {
  closeOnExhaust?: boolean;
  cache?: boolean;
  /** Injected for testing — defaults to `(url) => new WebSocket(url)` */
  _createSocket?: (url: string) => WebSocket;
}
