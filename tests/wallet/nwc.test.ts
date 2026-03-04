import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NwcProvider } from '../../lib/wallet/nwc.ts';

describe('NwcProvider', () => {
  describe('parseConnectionString', () => {
    it('parses valid URI into walletPubkey, relay, and secret', () => {
      const uri =
        'nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.example.com&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';

      const result = NwcProvider.parseConnectionString(uri);

      assert.equal(result.walletPubkey, 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4');
      assert.equal(result.relay, 'wss://relay.example.com');
      assert.equal(result.secret, '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c');
    });

    it('uses first relay when multiple are provided', () => {
      const uri =
        'nostr+walletconnect://abc123?relay=wss%3A%2F%2Ffirst.relay.com&relay=wss%3A%2F%2Fsecond.relay.com&secret=deadbeef';

      const result = NwcProvider.parseConnectionString(uri);

      assert.equal(result.relay, 'wss://first.relay.com');
    });

    it('throws on invalid scheme', () => {
      assert.throws(
        () => NwcProvider.parseConnectionString('https://invalid.example.com?relay=wss://r&secret=s'),
        (err: Error) => {
          assert.match(err.message, /must start with nostr\+walletconnect:\/\//);
          return true;
        },
      );
    });

    it('throws on missing relay parameter', () => {
      assert.throws(
        () => NwcProvider.parseConnectionString('nostr+walletconnect://pubkey?secret=abc123'),
        (err: Error) => {
          assert.match(err.message, /missing relay/);
          return true;
        },
      );
    });

    it('throws on missing secret parameter', () => {
      assert.throws(
        () =>
          NwcProvider.parseConnectionString(
            'nostr+walletconnect://pubkey?relay=wss%3A%2F%2Frelay.example.com',
          ),
        (err: Error) => {
          assert.match(err.message, /missing secret/);
          return true;
        },
      );
    });
  });

  describe('buildRequestContent', () => {
    it('produces valid JSON with method and params', () => {
      const content = NwcProvider.buildRequestContent('pay_invoice', { invoice: 'lnbc1...' });
      const parsed = JSON.parse(content);
      assert.equal(parsed.method, 'pay_invoice');
      assert.deepEqual(parsed.params, { invoice: 'lnbc1...' });
    });

    it('produces valid JSON for get_balance with empty params', () => {
      const content = NwcProvider.buildRequestContent('get_balance', {});
      const parsed = JSON.parse(content);
      assert.equal(parsed.method, 'get_balance');
      assert.deepEqual(parsed.params, {});
    });
  });

  describe('type field', () => {
    it('has type set to nwc', () => {
      const secret = new Uint8Array(32);
      const deps = {
        encrypt: async () => '',
        decrypt: async () => '',
        getPubkey: () => new Uint8Array(32),
        signEvent: async (e: unknown) => e as never,
      };
      const provider = new NwcProvider(
        {
          connectionString:
            'nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example.com&secret=deadbeef',
        },
        secret,
        deps,
      );
      assert.equal(provider.type, 'nwc');
    });
  });

  describe('isConnected', () => {
    it('returns false before connect is called', () => {
      const secret = new Uint8Array(32);
      const deps = {
        encrypt: async () => '',
        decrypt: async () => '',
        getPubkey: () => new Uint8Array(32),
        signEvent: async (e: unknown) => e as never,
      };
      const provider = new NwcProvider(
        {
          connectionString:
            'nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example.com&secret=deadbeef',
        },
        secret,
        deps,
      );
      assert.equal(provider.isConnected(), false);
    });
  });
});
