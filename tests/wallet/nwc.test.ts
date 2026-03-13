import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { NwcProvider } from '../../lib/wallet/nwc.ts';
import type { NwcCryptoDeps } from '../../lib/wallet/nwc.ts';
import type { UnsignedEvent, SignedEvent } from '../../lib/types.ts';

// ── Test constants ──

const WALLET_PUBKEY = 'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4';
const RELAY = 'wss://relay.example.com';
const SECRET_HEX = '71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c';
const CONNECTION_STRING = `nostr+walletconnect://${WALLET_PUBKEY}?relay=${encodeURIComponent(RELAY)}&secret=${SECRET_HEX}`;
const LOCAL_PUBKEY_HEX = 'aa'.repeat(32);

// ── Mock WebSocket ──

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateError() {
    this.onerror?.(new Error('connection failed'));
  }

  // Track all instances for test access
  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
}

// ── Mock crypto deps ──

let eventIdCounter = 0;

function createMockDeps(overrides?: Partial<NwcCryptoDeps>): NwcCryptoDeps {
  return {
    encrypt: async (plaintext: string, _privkey: Uint8Array, _theirPubkey: Uint8Array) =>
      `encrypted:${plaintext}`,
    decrypt: async (ciphertext: string, _privkey: Uint8Array, _theirPubkey: Uint8Array) =>
      ciphertext.replace('encrypted:', ''),
    getPubkey: (_privkey: Uint8Array) => {
      // Return bytes that produce LOCAL_PUBKEY_HEX when hex-encoded
      const bytes = new Uint8Array(32);
      bytes.fill(0xaa);
      return bytes;
    },
    signEvent: async (event: UnsignedEvent, _privkey: Uint8Array) => ({
      ...event,
      id: `test-event-id-${++eventIdCounter}`,
      pubkey: LOCAL_PUBKEY_HEX,
      sig: 'test-sig',
    } as SignedEvent),
    ...overrides,
  };
}

function createProvider(depsOverrides?: Partial<NwcCryptoDeps>): NwcProvider {
  const secret = new Uint8Array(32);
  secret.fill(0x42);
  return new NwcProvider(
    { connectionString: CONNECTION_STRING },
    secret,
    createMockDeps(depsOverrides),
  );
}

/** Get the latest MockWebSocket instance */
function latestWs(): MockWebSocket {
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  assert.ok(ws, 'Expected a MockWebSocket instance to exist');
  return ws;
}

/** Create a kind-23195 response EVENT message for a given request event ID */
function buildResponseMessage(
  requestId: string,
  content: string,
  pubkey: string = WALLET_PUBKEY,
): string {
  const event = {
    id: 'response-' + requestId,
    pubkey,
    kind: 23195,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['e', requestId],
      ['p', LOCAL_PUBKEY_HEX],
    ],
    content: `encrypted:${content}`,
    sig: 'response-sig',
  };
  return JSON.stringify(['EVENT', 'nwc-sub', event]);
}

/**
 * Wait for async sendRequest internals to complete.
 * sendRequest does `await encrypt()` and `await signEvent()` before calling ws.send(),
 * so we need to yield to let those resolve.
 *
 * Uses setImmediate which runs after ALL pending microtasks are processed,
 * unlike queueMicrotask which interleaves with chained awaits.
 * Also avoids interference with mock.timers (which only mocks setTimeout).
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

// ── Original WebSocket reference ──

const OriginalWebSocket = globalThis.WebSocket;

// ── Tests ──

describe('NwcProvider', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    eventIdCounter = 0;
    // Replace global WebSocket with mock
    (globalThis as any).WebSocket = MockWebSocket as any;
  });

  afterEach(() => {
    // Restore original WebSocket
    (globalThis as any).WebSocket = OriginalWebSocket;
  });

  // ────────────────────────────────────────────────────────────
  // Static method tests (kept from original)
  // ────────────────────────────────────────────────────────────

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
      const provider = createProvider();
      assert.equal(provider.type, 'nwc');
    });
  });

  describe('isConnected', () => {
    it('returns false before connect is called', () => {
      const provider = createProvider();
      assert.equal(provider.isConnected(), false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Connect / Disconnect
  // ────────────────────────────────────────────────────────────

  describe('NwcProvider connect/disconnect', () => {
    it('connect() opens WebSocket to the relay URL', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      assert.equal(ws.url, RELAY);
      ws.simulateOpen();
      await connectPromise;
    });

    it('connect() sends REQ subscription for kind 23195 on open', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      ws.simulateOpen();
      await connectPromise;

      assert.equal(ws.sentMessages.length, 1);
      const sub = JSON.parse(ws.sentMessages[0]);
      assert.equal(sub[0], 'REQ');
      assert.equal(sub[1], 'nwc-sub');
      assert.deepEqual(sub[2].kinds, [23195]);
      assert.deepEqual(sub[2].authors, [WALLET_PUBKEY]);
      assert.deepEqual(sub[2]['#p'], [LOCAL_PUBKEY_HEX]);
    });

    it('connect() resolves when onopen fires', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      // Should not be resolved yet
      let resolved = false;
      void connectPromise.then(() => { resolved = true; });

      // Give microtask a chance
      await flushAsync();
      assert.equal(resolved, false);

      ws.simulateOpen();
      await connectPromise;
      assert.equal(resolved, true);
    });

    it('connect() rejects when onerror fires', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      ws.simulateError();

      await assert.rejects(connectPromise, (err: Error) => {
        assert.match(err.message, /WebSocket connection failed/);
        return true;
      });
    });

    it('isConnected() returns true after successful connect', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      ws.simulateOpen();
      await connectPromise;

      assert.equal(provider.isConnected(), true);
    });

    it('disconnect() closes WebSocket and sets isConnected to false', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();

      ws.simulateOpen();
      await connectPromise;
      assert.equal(provider.isConnected(), true);

      provider.disconnect();
      assert.equal(provider.isConnected(), false);
      assert.equal(ws.readyState, MockWebSocket.CLOSED);
    });

    it('disconnect() rejects all pending requests', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await connectPromise;

      // Start a request (will be pending until response)
      // We must wait for sendRequest internals (encrypt, sign) to finish so the
      // pending entry is actually registered before we disconnect.
      const balancePromise = provider.getBalance();
      await flushAsync();

      // Disconnect while request is in-flight
      provider.disconnect();

      await assert.rejects(balancePromise, (err: Error) => {
        assert.match(err.message, /NWC disconnected/);
        return true;
      });
    });

    it('isConnected() returns false after WebSocket close event', async () => {
      const provider = createProvider();
      const connectPromise = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await connectPromise;

      // Simulate remote close (not via disconnect())
      ws.readyState = MockWebSocket.CLOSED;
      ws.onclose?.();

      assert.equal(provider.isConnected(), false);
    });
  });

  // ────────────────────────────────────────────────────────────
  // Request-Response Flow
  // ────────────────────────────────────────────────────────────

  describe('NwcProvider request-response flow', () => {
    let provider: NwcProvider;
    let ws: MockWebSocket;

    beforeEach(async () => {
      provider = createProvider();
      const p = provider.connect();
      ws = latestWs();
      ws.simulateOpen();
      await p;
      // Clear the REQ subscription message
      ws.sentMessages = [];
    });

    afterEach(() => {
      provider.disconnect();
    });

    it('getBalance() sends encrypted kind 23194 event via WebSocket', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync(); // Let encrypt + signEvent resolve

      assert.equal(ws.sentMessages.length, 1);
      const msg = JSON.parse(ws.sentMessages[0]);
      assert.equal(msg[0], 'EVENT');
      const event = msg[1] as SignedEvent;
      assert.equal(event.kind, 23194);
      assert.ok(event.content.startsWith('encrypted:'));
      assert.ok(event.sig);

      // Check the encrypted content contains the method
      const encryptedPayload = event.content.replace('encrypted:', '');
      const parsed = JSON.parse(encryptedPayload);
      assert.equal(parsed.method, 'get_balance');

      // Respond so the promise resolves
      const response = buildResponseMessage(
        event.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 100000 } }),
      );
      ws.simulateMessage(response);
      const result = await balancePromise;
      assert.equal(result.balance, 100); // 100000 msats = 100 sats
    });

    it('getBalance() resolves when matching response arrives (matched by e tag)', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send response with matching 'e' tag
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 42000 } }),
      );
      ws.simulateMessage(response);

      const result = await balancePromise;
      assert.equal(result.balance, 42); // 42000 msats = 42 sats
    });

    it('payInvoice() sends pay_invoice request with invoice param', async () => {
      const bolt11 = 'lnbc1pvjluezpp5qqqsyq...';
      const payPromise = provider.payInvoice(bolt11);
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;
      const encryptedPayload = sentEvent.content.replace('encrypted:', '');
      const parsed = JSON.parse(encryptedPayload);
      assert.equal(parsed.method, 'pay_invoice');
      assert.equal(parsed.params.invoice, bolt11);

      // Respond
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'pay_invoice', result: { preimage: 'abc123preimage' } }),
      );
      ws.simulateMessage(response);

      const result = await payPromise;
      assert.equal(result.preimage, 'abc123preimage');
    });

    it('makeInvoice() sends make_invoice request with amount and description', async () => {
      const invoicePromise = provider.makeInvoice(50000, 'test payment');
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;
      const encryptedPayload = sentEvent.content.replace('encrypted:', '');
      const parsed = JSON.parse(encryptedPayload);
      assert.equal(parsed.method, 'make_invoice');
      assert.equal(parsed.params.amount, 50000);
      assert.equal(parsed.params.description, 'test payment');

      // Respond
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({
          result_type: 'make_invoice',
          result: { invoice: 'lnbc50u1...', payment_hash: 'hash123' },
        }),
      );
      ws.simulateMessage(response);

      const result = await invoicePromise;
      assert.equal(result.bolt11, 'lnbc50u1...');
      assert.equal(result.paymentHash, 'hash123');
    });

    it('makeInvoice() omits description when memo is undefined', async () => {
      const invoicePromise = provider.makeInvoice(10000);
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;
      const encryptedPayload = sentEvent.content.replace('encrypted:', '');
      const parsed = JSON.parse(encryptedPayload);
      assert.equal(parsed.method, 'make_invoice');
      assert.equal(parsed.params.amount, 10000);
      assert.equal(parsed.params.description, undefined);

      // Respond
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({
          result_type: 'make_invoice',
          result: { invoice: 'lnbc10u1...', payment_hash: 'hash456' },
        }),
      );
      ws.simulateMessage(response);
      await invoicePromise;
    });

    it('getInfo() sends get_info request and returns alias and methods', async () => {
      const infoPromise = provider.getInfo();
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;
      const encryptedPayload = sentEvent.content.replace('encrypted:', '');
      const parsed = JSON.parse(encryptedPayload);
      assert.equal(parsed.method, 'get_info');

      // Respond
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({
          result_type: 'get_info',
          result: { alias: 'MyWallet', methods: ['pay_invoice', 'get_balance'] },
        }),
      );
      ws.simulateMessage(response);

      const result = await infoPromise;
      assert.equal(result.alias, 'MyWallet');
      assert.deepEqual(result.methods, ['pay_invoice', 'get_balance']);
    });

    it('getInfo() defaults methods to empty array when not in result', async () => {
      const infoPromise = provider.getInfo();
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({
          result_type: 'get_info',
          result: { alias: 'SimpleWallet' },
        }),
      );
      ws.simulateMessage(response);

      const result = await infoPromise;
      assert.equal(result.alias, 'SimpleWallet');
      assert.deepEqual(result.methods, []);
    });

    it('request throws when not connected', async () => {
      provider.disconnect();

      await assert.rejects(provider.getBalance(), (err: Error) => {
        assert.match(err.message, /NWC not connected/);
        return true;
      });
    });

    it('request event has correct p tag with wallet pubkey', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;
      const pTag = sentEvent.tags.find((t) => t[0] === 'p');
      assert.ok(pTag);
      assert.equal(pTag[1], WALLET_PUBKEY);

      // Respond to clean up
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 0 } }),
      );
      ws.simulateMessage(response);
      await balancePromise;
    });

    it('request rejects after timeout', async () => {
      mock.timers.enable({ apis: ['setTimeout'] });

      try {
        const balancePromise = provider.getBalance();
        await flushAsync();

        // Advance time past the 60-second timeout
        mock.timers.tick(60_001);

        await assert.rejects(balancePromise, (err: Error) => {
          assert.match(err.message, /timed out/);
          return true;
        });
      } finally {
        mock.timers.reset();
      }
    });
  });

  // ────────────────────────────────────────────────────────────
  // Response Handling
  // ────────────────────────────────────────────────────────────

  describe('NwcProvider response handling', () => {
    let provider: NwcProvider;
    let ws: MockWebSocket;

    beforeEach(async () => {
      provider = createProvider();
      const p = provider.connect();
      ws = latestWs();
      ws.simulateOpen();
      await p;
      ws.sentMessages = [];
    });

    afterEach(() => {
      provider.disconnect();
    });

    it('ignores non-EVENT messages (EOSE)', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send an EOSE message -- should be ignored
      ws.simulateMessage(JSON.stringify(['EOSE', 'nwc-sub']));

      // Now send the actual response
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 500000 } }),
      );
      ws.simulateMessage(response);

      const result = await balancePromise;
      assert.equal(result.balance, 500); // 500000 msats = 500 sats
    });

    it('ignores non-EVENT messages (OK)', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send an OK message -- should be ignored
      ws.simulateMessage(JSON.stringify(['OK', sentEvent.id, true, '']));

      // Send real response
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 800000 } }),
      );
      ws.simulateMessage(response);

      const result = await balancePromise;
      assert.equal(result.balance, 800); // 800000 msats = 800 sats
    });

    it('ignores events without matching e tag', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send a response with wrong request ID in 'e' tag
      const wrongResponse = buildResponseMessage(
        'wrong-event-id',
        JSON.stringify({ result_type: 'get_balance', result: { balance: 999 } }),
      );
      ws.simulateMessage(wrongResponse);

      // The promise should still be pending -- now send correct response
      const correctResponse = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 123000 } }),
      );
      ws.simulateMessage(correctResponse);

      const result = await balancePromise;
      assert.equal(result.balance, 123); // 123000 msats = 123 sats
    });

    it('ignores events with no e tag', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send a response event with no 'e' tag
      const noETagEvent = {
        id: 'no-e-tag-event',
        pubkey: WALLET_PUBKEY,
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', LOCAL_PUBKEY_HEX]], // no 'e' tag
        content: 'encrypted:whatever',
        sig: 'sig',
      };
      ws.simulateMessage(JSON.stringify(['EVENT', 'nwc-sub', noETagEvent]));

      // Send correct response
      const correctResponse = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 77000 } }),
      );
      ws.simulateMessage(correctResponse);

      const result = await balancePromise;
      assert.equal(result.balance, 77); // 77000 msats = 77 sats
    });

    it('rejects pending request on NWC error response', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send an error response
      const errorResponse = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({
          result_type: 'get_balance',
          error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough sats' },
        }),
      );
      ws.simulateMessage(errorResponse);

      await assert.rejects(balancePromise, (err: Error) => {
        assert.match(err.message, /INSUFFICIENT_BALANCE/);
        assert.match(err.message, /Not enough sats/);
        return true;
      });
    });

    it('handles malformed response JSON gracefully (rejects, does not crash)', async () => {
      const provider2 = createProvider({
        decrypt: async () => 'not valid json {{{',
      });
      const p = provider2.connect();
      const ws2 = latestWs();
      ws2.simulateOpen();
      await p;
      ws2.sentMessages = [];

      const balancePromise = provider2.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws2.sentMessages[0])[1] as SignedEvent;

      // Build response manually (decrypt will return invalid JSON)
      const responseEvent = {
        id: 'resp-' + sentEvent.id,
        pubkey: WALLET_PUBKEY,
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', sentEvent.id],
          ['p', LOCAL_PUBKEY_HEX],
        ],
        content: 'some-ciphertext',
        sig: 'sig',
      };
      ws2.simulateMessage(JSON.stringify(['EVENT', 'nwc-sub', responseEvent]));

      await assert.rejects(balancePromise, (err: Error) => {
        // Should be a JSON parse error
        assert.ok(err instanceof Error);
        return true;
      });

      provider2.disconnect();
    });

    it('handles non-JSON WebSocket messages gracefully (no crash)', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send raw text that is not JSON -- should be silently ignored
      ws.simulateMessage('this is not json');

      // Send correct response
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 10000 } }),
      );
      ws.simulateMessage(response);

      const result = await balancePromise;
      assert.equal(result.balance, 10); // 10000 msats = 10 sats
    });

    it('ignores events with non-23195 kind', async () => {
      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send an event with wrong kind
      const wrongKindEvent = {
        id: 'wrong-kind-event',
        pubkey: WALLET_PUBKEY,
        kind: 1, // not 23195
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', sentEvent.id],
          ['p', LOCAL_PUBKEY_HEX],
        ],
        content: 'encrypted:something',
        sig: 'sig',
      };
      ws.simulateMessage(JSON.stringify(['EVENT', 'nwc-sub', wrongKindEvent]));

      // Send correct response
      const correctResponse = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 55000 } }),
      );
      ws.simulateMessage(correctResponse);

      const result = await balancePromise;
      assert.equal(result.balance, 55); // 55000 msats = 55 sats
    });
  });

  // ────────────────────────────────────────────────────────────
  // Crypto Integration
  // ────────────────────────────────────────────────────────────

  describe('NwcProvider crypto integration', () => {
    it('encrypt() is called with walletPubkey bytes and request content', async () => {
      let capturedPlaintext = '';
      let capturedTheirPubkey: Uint8Array | null = null;

      const provider = createProvider({
        encrypt: async (plaintext: string, _privkey: Uint8Array, theirPubkey: Uint8Array) => {
          capturedPlaintext = plaintext;
          capturedTheirPubkey = new Uint8Array(theirPubkey);
          return `encrypted:${plaintext}`;
        },
      });

      const p = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await p;
      ws.sentMessages = [];

      const balancePromise = provider.getBalance();
      await flushAsync();

      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Verify encrypt was called with correct arguments
      assert.ok(capturedPlaintext.includes('get_balance'));
      assert.ok(capturedTheirPubkey instanceof Uint8Array);
      assert.equal(capturedTheirPubkey!.length, WALLET_PUBKEY.length / 2);

      // Verify the pubkey bytes match the hex wallet pubkey
      const expectedBytes = new Uint8Array(WALLET_PUBKEY.length / 2);
      for (let i = 0; i < expectedBytes.length; i++) {
        expectedBytes[i] = parseInt(WALLET_PUBKEY.slice(i * 2, i * 2 + 2), 16);
      }
      assert.deepEqual(capturedTheirPubkey, expectedBytes);

      // Clean up
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 0 } }),
      );
      ws.simulateMessage(response);
      await balancePromise;
      provider.disconnect();
    });

    it('decrypt() is called with walletPubkey bytes and response content', async () => {
      let capturedCiphertext = '';
      let capturedTheirPubkey: Uint8Array | null = null;

      const provider = createProvider({
        decrypt: async (ciphertext: string, _privkey: Uint8Array, theirPubkey: Uint8Array) => {
          capturedCiphertext = ciphertext;
          capturedTheirPubkey = new Uint8Array(theirPubkey);
          // Return valid decrypted content (balance in msats)
          return JSON.stringify({ result_type: 'get_balance', result: { balance: 300000 } });
        },
      });

      const p = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await p;
      ws.sentMessages = [];

      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Send response with specific ciphertext
      const responseEvent = {
        id: 'resp-' + sentEvent.id,
        pubkey: WALLET_PUBKEY,
        kind: 23195,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', sentEvent.id],
          ['p', LOCAL_PUBKEY_HEX],
        ],
        content: 'the-ciphertext-blob',
        sig: 'sig',
      };
      ws.simulateMessage(JSON.stringify(['EVENT', 'nwc-sub', responseEvent]));

      await balancePromise;

      // Verify decrypt was called with correct arguments
      assert.equal(capturedCiphertext, 'the-ciphertext-blob');
      assert.ok(capturedTheirPubkey instanceof Uint8Array);

      const expectedBytes = new Uint8Array(WALLET_PUBKEY.length / 2);
      for (let i = 0; i < expectedBytes.length; i++) {
        expectedBytes[i] = parseInt(WALLET_PUBKEY.slice(i * 2, i * 2 + 2), 16);
      }
      assert.deepEqual(capturedTheirPubkey, expectedBytes);

      provider.disconnect();
    });

    it('signEvent() is called with kind 23194 and correct p tag', async () => {
      let capturedEvent: UnsignedEvent | null = null;

      const provider = createProvider({
        signEvent: async (event: UnsignedEvent, _privkey: Uint8Array) => {
          capturedEvent = { ...event };
          return {
            ...event,
            id: `test-event-id-${++eventIdCounter}`,
            pubkey: LOCAL_PUBKEY_HEX,
            sig: 'test-sig',
          } as SignedEvent;
        },
      });

      const p = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await p;
      ws.sentMessages = [];

      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Verify signEvent was called with correct unsigned event
      assert.ok(capturedEvent);
      assert.equal(capturedEvent!.kind, 23194);
      const pTag = capturedEvent!.tags.find((t) => t[0] === 'p');
      assert.ok(pTag);
      assert.equal(pTag![1], WALLET_PUBKEY);
      assert.ok(capturedEvent!.content.startsWith('encrypted:'));
      assert.ok(capturedEvent!.created_at > 0);

      // Clean up
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 0 } }),
      );
      ws.simulateMessage(response);
      await balancePromise;
      provider.disconnect();
    });

    it('getPubkey() result is used as the pubkey field in unsigned events', async () => {
      const customPubkeyHex = 'bb'.repeat(32);
      const customPubkeyBytes = new Uint8Array(32);
      customPubkeyBytes.fill(0xbb);

      const provider = createProvider({
        getPubkey: () => customPubkeyBytes,
        signEvent: async (event: UnsignedEvent, _privkey: Uint8Array) => ({
          ...event,
          id: `test-event-id-${++eventIdCounter}`,
          pubkey: customPubkeyHex,
          sig: 'test-sig',
        } as SignedEvent),
      });

      const p = provider.connect();
      const ws = latestWs();
      ws.simulateOpen();
      await p;

      // Check the REQ subscription uses the custom pubkey
      const sub = JSON.parse(ws.sentMessages[0]);
      assert.deepEqual(sub[2]['#p'], [customPubkeyHex]);

      ws.sentMessages = [];

      const balancePromise = provider.getBalance();
      await flushAsync();
      const sentEvent = JSON.parse(ws.sentMessages[0])[1] as SignedEvent;

      // Verify the signed event uses the custom pubkey
      assert.equal(sentEvent.pubkey, customPubkeyHex);

      // Clean up
      const response = buildResponseMessage(
        sentEvent.id,
        JSON.stringify({ result_type: 'get_balance', result: { balance: 0 } }),
      );
      ws.simulateMessage(response);
      await balancePromise;
      provider.disconnect();
    });
  });
});
