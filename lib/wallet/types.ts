/**
 * Wallet provider types for Lightning/Zaps support
 * @module lib/wallet/types
 */

// ── Wallet Configuration ──

export type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string; nwcUri?: string };

// ── Wallet Provider ──

export interface WalletProviderInfo {
  alias?: string;
  methods: string[];
}

export interface WalletProvider {
  readonly type: 'nwc' | 'lnbits';
  getInfo(): Promise<WalletProviderInfo>;
  getBalance(): Promise<{ balance: number }>;
  payInvoice(bolt11: string): Promise<{ preimage: string }>;
  makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }>;
  listTransactions(limit?: number, offset?: number): Promise<Transaction[]>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}

// ── Transaction ──

export interface Transaction {
  paymentHash: string;
  bolt11?: string;
  amount: number;        // sats, positive = incoming, negative = outgoing
  fee?: number;          // sats
  memo?: string;
  status: 'settled' | 'pending' | 'failed';
  createdAt: number;     // unix timestamp
  preimage?: string;
}

// ── Safe Wallet Info (no secrets) ──

export interface SafeWalletInfo {
  type: 'nwc' | 'lnbits';
  connected: boolean;
  alias?: string;
  instanceUrl?: string;
}
