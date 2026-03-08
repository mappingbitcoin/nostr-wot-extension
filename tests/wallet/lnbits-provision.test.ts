/**
 * LNbits auto-provisioning tests
 *
 * Tests provisionLnbitsWallet() which uses a two-step challenge-response:
 *   1. GET  /api/provision/challenge → { challenge }
 *   2. Sign challenge with signFn → kind:27235 event
 *   3. POST /api/provision with { name, event }
 *
 * Run with:
 *   node --import tsx --test tests/wallet/lnbits-provision.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { provisionLnbitsWallet, DEFAULT_LNBITS_URL } from '../../lib/wallet/lnbits-provision.ts';
import type { SignedEvent } from '../../lib/types.ts';

const FAKE_CHALLENGE = 'a1b2c3d4e5f6';

const FAKE_SIGNED_EVENT: SignedEvent = {
  id: 'event-id-123',
  pubkey: 'pubkey-abc',
  created_at: 1700000000,
  kind: 27235,
  tags: [['challenge', FAKE_CHALLENGE], ['u', 'https://zaps.example.com/api/provision']],
  content: '',
  sig: 'sig-xyz',
};

function createMockSignFn(expectedChallenge?: string) {
  let called = false;
  let receivedChallenge = '';
  const signFn = async (challenge: string): Promise<SignedEvent> => {
    called = true;
    receivedChallenge = challenge;
    if (expectedChallenge !== undefined) {
      assert.strictEqual(challenge, expectedChallenge);
    }
    return FAKE_SIGNED_EVENT;
  };
  return { signFn, wasCalled: () => called, getChallenge: () => receivedChallenge };
}

describe('provisionLnbitsWallet', () => {
  it('fetches challenge, calls signFn, sends signed event in POST body', async () => {
    const { signFn, wasCalled } = createMockSignFn(FAKE_CHALLENGE);
    let postBody: Record<string, unknown> | null = null;

    const mockFetch = async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        // Challenge endpoint
        assert.strictEqual(url, 'https://zaps.example.com/api/provision/challenge');
        return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
      }
      // Provision endpoint
      assert.strictEqual(url, 'https://zaps.example.com/api/provision');
      assert.strictEqual(init.method, 'POST');
      const headers = init.headers as Record<string, string>;
      assert.strictEqual(headers['Content-Type'], 'application/json');
      postBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({
        id: 'wallet-id-123',
        name: 'WoT:npub1abc1234',
        adminkey: 'admin-key-abc',
        inkey: 'invoice-key-xyz',
        balance_msat: 0,
        user: 'user-id-456',
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet(
      'https://zaps.example.com',
      'WoT:npub1abc1234',
      signFn,
      mockFetch as typeof fetch,
    );

    assert.strictEqual(result.adminKey, 'admin-key-abc');
    assert.strictEqual(result.walletId, 'wallet-id-123');
    assert.strictEqual(wasCalled(), true);
    assert.ok(postBody);
    assert.strictEqual((postBody as Record<string, unknown>).name, 'WoT:npub1abc1234');
    assert.deepStrictEqual((postBody as Record<string, unknown>).event, FAKE_SIGNED_EVENT);
  });

  it('strips trailing slashes from instance URL', async () => {
    const capturedUrls: string[] = [];
    const { signFn } = createMockSignFn();

    const mockFetch = async (url: string, init?: RequestInit) => {
      capturedUrls.push(url);
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test', balance_msat: 0, user: 'u1',
      }), { status: 201 });
    };

    await provisionLnbitsWallet('https://zaps.example.com/', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(capturedUrls[0], 'https://zaps.example.com/api/provision/challenge');
    assert.strictEqual(capturedUrls[1], 'https://zaps.example.com/api/provision');
  });

  it('throws on challenge request failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async () => new Response('Service Unavailable', { status: 503 });
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message.includes('Challenge request failed: 503'),
    );
  });

  it('throws on provision POST failure', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      (err: Error) => err.message.includes('Wallet provisioning failed: 403'),
    );
  });

  it('throws on network error', async () => {
    const { signFn } = createMockSignFn();
    const mockFetch = async () => { throw new Error('Network error'); };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch),
      { message: 'Network error' },
    );
  });

  it('throws when signFn throws', async () => {
    const failSignFn = async () => { throw new Error('No private key'); };
    const mockFetch = async () => {
      return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
    };
    await assert.rejects(
      () => provisionLnbitsWallet('https://zaps.example.com', 'test', failSignFn, mockFetch as typeof fetch),
      { message: 'No private key' },
    );
  });

  it('returns nwcUri when present in provision response', async () => {
    const { signFn } = createMockSignFn();
    const nwcUri = 'nostr+walletconnect://pubkey?relay=wss://relay.test&secret=abc';

    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test',
        balance_msat: 0, user: 'u1', nwcUri,
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(result.nwcUri, nwcUri);
  });

  it('returns undefined nwcUri when not present in response', async () => {
    const { signFn } = createMockSignFn();

    const mockFetch = async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ challenge: FAKE_CHALLENGE }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: 'w1', adminkey: 'k1', inkey: 'i1', name: 'test',
        balance_msat: 0, user: 'u1',
      }), { status: 201 });
    };

    const result = await provisionLnbitsWallet('https://zaps.example.com', 'test', signFn, mockFetch as typeof fetch);
    assert.strictEqual(result.nwcUri, undefined);
  });

  it('exports DEFAULT_LNBITS_URL pointing to zaps.nostr-wot.com', () => {
    assert.strictEqual(typeof DEFAULT_LNBITS_URL, 'string');
    assert.strictEqual(DEFAULT_LNBITS_URL, 'https://zaps.nostr-wot.com');
  });
});
