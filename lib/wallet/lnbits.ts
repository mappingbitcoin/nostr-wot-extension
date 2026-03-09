/**
 * LNbits wallet provider implementation
 * @module lib/wallet/lnbits
 */

import type { WalletProvider, WalletProviderInfo, Transaction } from './types.ts';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface LnbitsConfig {
  instanceUrl: string;
  adminKey: string;
}

export class LnbitsProvider implements WalletProvider {
  readonly type = 'lnbits' as const;

  private readonly instanceUrl: string;
  private readonly adminKey: string;
  private readonly fetchFn: FetchFn;
  private _connected = false;

  constructor(config: LnbitsConfig, fetchFn?: FetchFn) {
    this.instanceUrl = config.instanceUrl.replace(/\/+$/, '');
    this.adminKey = config.adminKey;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.instanceUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'X-Api-Key': this.adminKey,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchFn(url, init);
    if (!res.ok) {
      throw new Error(`LNbits API error: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async getInfo(): Promise<WalletProviderInfo> {
    const data = await this.request<{ name: string }>('GET', '/api/v1/wallet');
    return {
      alias: data.name,
      methods: ['pay_invoice', 'get_balance', 'make_invoice'],
    };
  }

  async getBalance(): Promise<{ balance: number }> {
    const data = await this.request<{ balance: number }>('GET', '/api/v1/wallet');
    return { balance: data.balance };
  }

  async payInvoice(bolt11: string): Promise<{ preimage: string }> {
    const data = await this.request<{ preimage: string }>('POST', '/api/v1/payments', {
      out: true,
      bolt11,
    });
    return { preimage: data.preimage };
  }

  async makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }> {
    const data = await this.request<{ payment_request: string; payment_hash: string }>(
      'POST',
      '/api/v1/payments',
      { out: false, amount, memo },
    );
    return { bolt11: data.payment_request, paymentHash: data.payment_hash };
  }

  async listTransactions(limit = 20, offset = 0): Promise<Transaction[]> {
    const data = await this.request<Array<{
      checking_id: string;
      payment_hash: string;
      bolt11: string;
      amount: number;       // msats in LNbits
      fee: number;          // msats
      memo: string;
      status: string;
      time: number;
      preimage: string;
    }>>('GET', `/api/v1/payments?limit=${limit}&offset=${offset}`);

    return data.map(p => ({
      paymentHash: p.payment_hash,
      bolt11: p.bolt11,
      amount: Math.round(p.amount / 1000),   // msats → sats
      fee: Math.round((p.fee || 0) / 1000),
      memo: p.memo || undefined,
      status: p.status === 'success' ? 'settled' as const : p.status === 'pending' ? 'pending' as const : 'failed' as const,
      createdAt: p.time,
      preimage: p.preimage || undefined,
    }));
  }

  async connect(): Promise<void> {
    await this.getBalance();
    this._connected = true;
  }

  disconnect(): void {
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }
}
