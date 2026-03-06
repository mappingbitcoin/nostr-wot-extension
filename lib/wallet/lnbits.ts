/**
 * LNbits wallet provider implementation
 * @module lib/wallet/lnbits
 */

import type { WalletProvider, WalletProviderInfo } from './types.ts';

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
