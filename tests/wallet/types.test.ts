import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { WalletConfig, WalletProviderInfo, WalletProvider, SafeWalletInfo } from '../../lib/wallet/types.ts';

describe('WalletConfig', () => {
  it('accepts NWC config with required fields', () => {
    const config: WalletConfig = {
      type: 'nwc',
      connectionString: 'nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex',
    };
    assert.equal(config.type, 'nwc');
    assert.equal(config.connectionString, 'nostr+walletconnect://pubkey?relay=wss://relay.example.com&secret=hex');
  });

  it('accepts NWC config with optional relay', () => {
    const config: WalletConfig = {
      type: 'nwc',
      connectionString: 'nostr+walletconnect://pubkey?secret=hex',
      relay: 'wss://relay.custom.com',
    };
    assert.equal(config.type, 'nwc');
    assert.equal(config.relay, 'wss://relay.custom.com');
  });

  it('accepts LNbits config with required fields', () => {
    const config: WalletConfig = {
      type: 'lnbits',
      instanceUrl: 'https://lnbits.example.com',
      adminKey: 'abc123def456',
    };
    assert.equal(config.type, 'lnbits');
    assert.equal(config.instanceUrl, 'https://lnbits.example.com');
    assert.equal(config.adminKey, 'abc123def456');
  });

  it('accepts LNbits config with optional walletId', () => {
    const config: WalletConfig = {
      type: 'lnbits',
      instanceUrl: 'https://lnbits.example.com',
      adminKey: 'abc123def456',
      walletId: 'wallet-xyz',
    };
    assert.equal(config.type, 'lnbits');
    assert.equal(config.walletId, 'wallet-xyz');
  });

  it('discriminates NWC from LNbits by type field', () => {
    const nwc: WalletConfig = {
      type: 'nwc',
      connectionString: 'nostr+walletconnect://test',
    };
    const lnbits: WalletConfig = {
      type: 'lnbits',
      instanceUrl: 'https://lnbits.example.com',
      adminKey: 'key123',
    };

    if (nwc.type === 'nwc') {
      assert.equal(typeof nwc.connectionString, 'string');
    } else {
      assert.fail('Expected NWC type');
    }

    if (lnbits.type === 'lnbits') {
      assert.equal(typeof lnbits.instanceUrl, 'string');
      assert.equal(typeof lnbits.adminKey, 'string');
    } else {
      assert.fail('Expected LNbits type');
    }
  });
});

describe('SafeWalletInfo', () => {
  it('represents a connected NWC wallet', () => {
    const info: SafeWalletInfo = {
      type: 'nwc',
      connected: true,
      alias: 'My NWC Wallet',
    };
    assert.equal(info.type, 'nwc');
    assert.equal(info.connected, true);
    assert.equal(info.alias, 'My NWC Wallet');
    assert.equal(info.instanceUrl, undefined);
  });

  it('represents a disconnected LNbits wallet', () => {
    const info: SafeWalletInfo = {
      type: 'lnbits',
      connected: false,
      instanceUrl: 'https://lnbits.example.com',
    };
    assert.equal(info.type, 'lnbits');
    assert.equal(info.connected, false);
    assert.equal(info.instanceUrl, 'https://lnbits.example.com');
    assert.equal(info.alias, undefined);
  });

  it('accepts minimal fields without optionals', () => {
    const info: SafeWalletInfo = {
      type: 'nwc',
      connected: false,
    };
    assert.equal(info.type, 'nwc');
    assert.equal(info.connected, false);
    assert.equal(info.alias, undefined);
    assert.equal(info.instanceUrl, undefined);
  });
});

describe('WalletProviderInfo', () => {
  it('contains supported methods list', () => {
    const info: WalletProviderInfo = {
      alias: 'Test Wallet',
      methods: ['pay_invoice', 'get_balance', 'make_invoice'],
    };
    assert.equal(info.alias, 'Test Wallet');
    assert.deepEqual(info.methods, ['pay_invoice', 'get_balance', 'make_invoice']);
  });

  it('accepts empty methods list', () => {
    const info: WalletProviderInfo = {
      methods: [],
    };
    assert.deepEqual(info.methods, []);
    assert.equal(info.alias, undefined);
  });
});
