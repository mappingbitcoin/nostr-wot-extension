import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LnbitsProvider } from '../../lib/wallet/lnbits.ts';

/** Helper to build a mock fetch that returns the given JSON body with status 200. */
function mockFetch(body: unknown, status = 200): (url: string, init?: RequestInit) => Promise<Response> {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

/** Helper that captures the arguments passed to fetch and returns a preset response. */
function capturingFetch(body: unknown, status = 200) {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fn = async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fn, getCapturedUrl: () => capturedUrl, getCapturedInit: () => capturedInit };
}

describe('LnbitsProvider', () => {
  const config = { instanceUrl: 'https://lnbits.example.com', adminKey: 'testapikey123' };

  describe('getBalance', () => {
    it('returns balance in msats', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 100_000 }));
      const result = await provider.getBalance();
      assert.deepEqual(result, { balance: 100_000 });
    });

    it('sends admin key in X-Api-Key header', async () => {
      const { fn, getCapturedInit } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(config, fn);
      await provider.getBalance();
      const headers = getCapturedInit()?.headers as Record<string, string>;
      assert.equal(headers['X-Api-Key'], 'testapikey123');
    });

    it('sends GET request to /api/v1/wallet', async () => {
      const { fn, getCapturedUrl, getCapturedInit } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(config, fn);
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
      assert.equal(getCapturedInit()?.method, 'GET');
    });
  });

  describe('getInfo', () => {
    it('returns alias and supported methods', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ name: 'My LNbits Wallet' }));
      const info = await provider.getInfo();
      assert.equal(info.alias, 'My LNbits Wallet');
      assert.deepEqual(info.methods, ['pay_invoice', 'get_balance', 'make_invoice']);
    });
  });

  describe('payInvoice', () => {
    it('sends bolt11 with out:true and returns preimage', async () => {
      const bolt11 = 'lnbc1pvjluezpp5qqqsyq...';
      const { fn, getCapturedInit } = capturingFetch({ preimage: 'abc123preimage' });
      const provider = new LnbitsProvider(config, fn);
      const result = await provider.payInvoice(bolt11);

      assert.equal(result.preimage, 'abc123preimage');
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, true);
      assert.equal(body.bolt11, bolt11);
    });

    it('sends POST request to /api/v1/payments', async () => {
      const { fn, getCapturedUrl, getCapturedInit } = capturingFetch({ preimage: 'x' });
      const provider = new LnbitsProvider(config, fn);
      await provider.payInvoice('lnbc1...');
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/payments');
      assert.equal(getCapturedInit()?.method, 'POST');
    });
  });

  describe('makeInvoice', () => {
    it('sends amount/memo with out:false and returns bolt11 + paymentHash', async () => {
      const { fn, getCapturedInit } = capturingFetch({
        payment_request: 'lnbc50n1...',
        payment_hash: 'hash123',
      });
      const provider = new LnbitsProvider(config, fn);
      const result = await provider.makeInvoice(50_000, 'test payment');

      assert.equal(result.bolt11, 'lnbc50n1...');
      assert.equal(result.paymentHash, 'hash123');
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, false);
      assert.equal(body.amount, 50_000);
      assert.equal(body.memo, 'test payment');
    });

    it('sends request without memo when not provided', async () => {
      const { fn, getCapturedInit } = capturingFetch({
        payment_request: 'lnbc1...',
        payment_hash: 'hash456',
      });
      const provider = new LnbitsProvider(config, fn);
      await provider.makeInvoice(1000);
      const body = JSON.parse(getCapturedInit()?.body as string);
      assert.equal(body.out, false);
      assert.equal(body.amount, 1000);
      assert.equal(body.memo, undefined);
    });
  });

  describe('error handling', () => {
    it('throws on HTTP 401 error', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ detail: 'Unauthorized' }, 401));
      await assert.rejects(() => provider.getBalance(), (err: Error) => {
        assert.match(err.message, /401/);
        return true;
      });
    });

    it('throws on HTTP 500 error', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ detail: 'Internal' }, 500));
      await assert.rejects(() => provider.payInvoice('lnbc1...'), (err: Error) => {
        assert.match(err.message, /500/);
        return true;
      });
    });

    it('includes LNbits API error prefix in message', async () => {
      const provider = new LnbitsProvider(config, mockFetch({}, 403));
      await assert.rejects(() => provider.getInfo(), (err: Error) => {
        assert.match(err.message, /LNbits API error/);
        return true;
      });
    });
  });

  describe('connection state', () => {
    it('isConnected returns false initially', () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      assert.equal(provider.isConnected(), false);
    });

    it('isConnected returns true after connect()', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      await provider.connect();
      assert.equal(provider.isConnected(), true);
    });

    it('disconnect resets connection state', async () => {
      const provider = new LnbitsProvider(config, mockFetch({ balance: 0 }));
      await provider.connect();
      assert.equal(provider.isConnected(), true);
      provider.disconnect();
      assert.equal(provider.isConnected(), false);
    });

    it('connect validates by calling getBalance', async () => {
      const provider = new LnbitsProvider(config, mockFetch({}, 401));
      await assert.rejects(() => provider.connect(), (err: Error) => {
        assert.match(err.message, /401/);
        return true;
      });
      assert.equal(provider.isConnected(), false);
    });
  });

  describe('URL normalization', () => {
    it('strips trailing slash from instanceUrl', async () => {
      const { fn, getCapturedUrl } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(
        { instanceUrl: 'https://lnbits.example.com/', adminKey: 'key' },
        fn,
      );
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
    });

    it('strips multiple trailing slashes from instanceUrl', async () => {
      const { fn, getCapturedUrl } = capturingFetch({ balance: 0 });
      const provider = new LnbitsProvider(
        { instanceUrl: 'https://lnbits.example.com///', adminKey: 'key' },
        fn,
      );
      await provider.getBalance();
      assert.equal(getCapturedUrl(), 'https://lnbits.example.com/api/v1/wallet');
    });
  });

  describe('type field', () => {
    it('has type set to lnbits', () => {
      const provider = new LnbitsProvider(config, mockFetch({}));
      assert.equal(provider.type, 'lnbits');
    });
  });
});
