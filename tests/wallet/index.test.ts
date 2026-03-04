import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getWalletProvider,
  setWalletProvider,
  removeWalletProvider,
  clearWalletProviders,
  hasWalletConfig,
} from '../../lib/wallet/index.ts';
import type { WalletConfig, WalletProvider } from '../../lib/wallet/index.ts';

/** Minimal mock provider for testing cache behavior. */
function mockProvider(type: 'nwc' | 'lnbits' = 'nwc'): WalletProvider & { disconnected: boolean } {
  return {
    type,
    disconnected: false,
    async getInfo() { return { alias: 'mock', methods: [] }; },
    async getBalance() { return { balance: 0 }; },
    async payInvoice(_bolt11: string) { return { preimage: 'mock' }; },
    async makeInvoice(_amount: number) { return { bolt11: 'lnbc1...', paymentHash: 'hash' }; },
    async connect() {},
    disconnect() { this.disconnected = true; },
    isConnected() { return !this.disconnected; },
  };
}

describe('Wallet provider factory', () => {
  // Clear cache between tests so state doesn't leak
  beforeEach(() => {
    clearWalletProviders();
  });

  describe('getWalletProvider', () => {
    it('returns null for undefined config', () => {
      const result = getWalletProvider('acct-1', undefined);
      assert.equal(result, null);
    });

    it('returns null for null config', () => {
      const result = getWalletProvider('acct-1', null);
      assert.equal(result, null);
    });

    it('creates LnbitsProvider for lnbits config', () => {
      const config: WalletConfig = {
        type: 'lnbits',
        instanceUrl: 'https://lnbits.example.com',
        adminKey: 'testkey',
      };
      const provider = getWalletProvider('acct-1', config);
      assert.notEqual(provider, null);
      assert.equal(provider!.type, 'lnbits');
    });

    it('caches provider instance per account (same reference on second call)', () => {
      const config: WalletConfig = {
        type: 'lnbits',
        instanceUrl: 'https://lnbits.example.com',
        adminKey: 'testkey',
      };
      const first = getWalletProvider('acct-1', config);
      const second = getWalletProvider('acct-1', config);
      assert.equal(first, second, 'should return the same cached reference');
    });

    it('returns different providers for different account IDs', () => {
      const config: WalletConfig = {
        type: 'lnbits',
        instanceUrl: 'https://lnbits.example.com',
        adminKey: 'testkey',
      };
      const p1 = getWalletProvider('acct-1', config);
      const p2 = getWalletProvider('acct-2', config);
      assert.notEqual(p1, p2, 'different accounts should get different providers');
    });

    it('throws for nwc config (requires crypto deps)', () => {
      const config: WalletConfig = {
        type: 'nwc',
        connectionString: 'nostr+walletconnect://abc?relay=wss://r.example.com&secret=def',
      };
      assert.throws(
        () => getWalletProvider('acct-1', config),
        (err: Error) => {
          assert.match(err.message, /createNwcProvider/);
          return true;
        },
      );
    });
  });

  describe('setWalletProvider', () => {
    it('caches an externally-created provider', () => {
      const provider = mockProvider('nwc');
      setWalletProvider('acct-1', provider);

      // getWalletProvider should return the cached instance even with a config
      // that would normally throw (because it finds the cache first)
      const config: WalletConfig = {
        type: 'nwc',
        connectionString: 'nostr+walletconnect://abc?relay=wss://r&secret=s',
      };
      const cached = getWalletProvider('acct-1', config);
      assert.equal(cached, provider);
    });
  });

  describe('removeWalletProvider', () => {
    it('disconnects and removes the cached provider', () => {
      const provider = mockProvider();
      setWalletProvider('acct-1', provider);

      removeWalletProvider('acct-1');
      assert.equal(provider.disconnected, true);

      // After removal, getWalletProvider returns null for undefined config
      assert.equal(getWalletProvider('acct-1', undefined), null);
    });

    it('is a no-op for non-existent account', () => {
      // Should not throw
      removeWalletProvider('non-existent');
    });
  });

  describe('clearWalletProviders', () => {
    it('disconnects all and clears cache', () => {
      const p1 = mockProvider();
      const p2 = mockProvider();
      setWalletProvider('acct-1', p1);
      setWalletProvider('acct-2', p2);

      clearWalletProviders();

      assert.equal(p1.disconnected, true);
      assert.equal(p2.disconnected, true);

      // Cache should be empty now
      assert.equal(getWalletProvider('acct-1', undefined), null);
      assert.equal(getWalletProvider('acct-2', undefined), null);
    });
  });

  describe('hasWalletConfig', () => {
    it('returns false for undefined', () => {
      assert.equal(hasWalletConfig(undefined), false);
    });

    it('returns false for null', () => {
      assert.equal(hasWalletConfig(null), false);
    });

    it('returns true for valid lnbits config', () => {
      const config: WalletConfig = {
        type: 'lnbits',
        instanceUrl: 'https://lnbits.example.com',
        adminKey: 'key',
      };
      assert.equal(hasWalletConfig(config), true);
    });

    it('returns true for valid nwc config', () => {
      const config: WalletConfig = {
        type: 'nwc',
        connectionString: 'nostr+walletconnect://abc?relay=wss://r&secret=s',
      };
      assert.equal(hasWalletConfig(config), true);
    });
  });
});
