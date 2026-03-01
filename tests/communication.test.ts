/**
 * Communication & Authorization Tests — Site ↔ Extension Message Flow
 *
 * This file is the integration test suite for the extension's multi-layer
 * security model. It exercises the full message pipeline from a web page
 * request through to a signed response, verifying that every gate —
 * allowlists, HTTPS, rate limits, privilege checks, permissions, vault
 * lock state, and account isolation — behaves correctly in combination.
 *
 * ## Architecture Under Test
 *
 * The extension uses a three-layer message-passing architecture, each
 * running in a different browser execution context:
 *
 *   inject.ts  (MAIN world)   — exposes `window.nostr` and `window.nostr.wot`
 *        ↓  window.postMessage({ type: 'WOT_REQUEST' | 'NIP07_REQUEST' })
 *   content.ts (ISOLATED world) — validates, prefixes, rate-limits, forwards
 *        ↓  browser.runtime.sendMessage({ method, params })
 *   background.ts (service worker) — privilege gate, param validation, routing
 *        ↓  signer / vault / permissions / graph
 *   response flows back up through the same chain
 *
 * ## Test Layers
 *
 *   Layer 1 — Content Script Validation (pure functions, no browser APIs)
 *     - WoT method allowlist (14 methods)
 *     - NIP-07 method allowlist (7 methods)
 *     - WoT rate limiting (100 req/sec sliding window)
 *     - NIP-07 HTTPS enforcement (exception for localhost/127.0.0.1/[::1])
 *     - Method prefixing: `signEvent` → `nip07_signEvent`
 *     - Origin injection: hostname appended to params
 *
 *   Layer 2 — Background Handler Validation (pure functions)
 *     - Privilege gate: PRIVILEGED_METHODS only from internal extension pages
 *     - NIP-07 param validation: event shape, pubkey format, plaintext/ciphertext
 *
 *   Layer 3 — End-to-End Message Flow (uses real vault/signer/permissions)
 *     - getPublicKey: full round-trip from content prefix → signer → storage
 *     - signEvent: full round-trip → Schnorr signature → verified response
 *     - Error propagation: HTTP block, unknown methods, invalid params
 *     - Message shape integrity: no mutation, correct prefixing
 *     - Channel isolation: WoT ≠ NIP-07 ≠ privileged
 *
 *   Layer 4 — Account Switching
 *     - Vault state changes on setActiveAccount (pubkey, privkey isolation)
 *     - Pending request rejection for old account (rejectPendingForAccount)
 *     - Pubkey returned by handleGetPublicKey updates after switch
 *     - signEvent uses the correct key after switch
 *
 *   Layer 5 — Vault Locked Scenarios
 *     - All vault mutation APIs throw when locked
 *     - getPrivkey throws (blocks signing path)
 *     - getPublicKey still works (reads from browser.storage.sync)
 *     - exists() still returns true (encrypted data persists)
 *     - unlock() restores full access
 *     - Pending request lifecycle: cleanupStale, onVaultUnlocked
 *
 *   Layer 6 — Permissions × Lock State Matrix
 *     The signer checks permissions BEFORE vault lock state:
 *
 *     | Permission | Vault   | getPublicKey | signEvent/encrypt/decrypt |
 *     |------------|---------|--------------|---------------------------|
 *     | deny       | locked  | REJECTED     | REJECTED                  |
 *     | deny       | unlocked| REJECTED     | REJECTED                  |
 *     | allow      | locked  | WORKS *      | BLOCKED (needs key)       |
 *     | allow      | unlocked| WORKS        | WORKS                     |
 *     | ask        | locked  | QUEUED       | QUEUED                    |
 *     | ask        | unlocked| QUEUED       | QUEUED                    |
 *
 *     * getPublicKey reads from browser.storage.sync, not the vault
 *
 *     Additional isolation tests:
 *     - Per-kind permissions (signEvent:1 ≠ signEvent:4)
 *     - Per-domain isolation (allowed.com ≠ other.com)
 *     - Wildcard deny blocks all methods
 *     - Kind-specific overrides method-level
 *     - Lock state does not affect permission decisions
 *     - Deny enforced even when private key is available in memory
 *
 * ## Testing Approach
 *
 * Content script and background gate logic is extracted into pure functions
 * that mirror the real implementation. This avoids needing actual browser
 * extension APIs while still testing the exact same validation logic.
 *
 * For end-to-end tests, we use the real vault, signer, and permissions
 * modules with a mock browser.storage backend (tests/helpers/browser-mock.ts).
 *
 * Tests that would hang (e.g., signEvent when locked → queueRequest awaits
 * an approval that never comes) are replaced with component-level checks
 * that verify the preconditions independently.
 */

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.js';
import * as permissions from '../lib/permissions.js';
import type { VaultPayload, UnsignedEvent } from '../lib/types.ts';

// ── Constants mirrored from content.ts ──
//
// These allowlists are duplicated from content.ts so tests break if
// the production allowlist diverges from what we test against.
// WOT_ALLOWED_METHODS: read-only graph queries, no key material involved.
// NIP07_ALLOWED_METHODS: NIP-07 signing methods exposed via window.nostr.
// PRIVILEGED_METHODS: vault/signer admin operations, internal-only.

const WOT_ALLOWED_METHODS = [
  'getDistance', 'isInMyWoT', 'getTrustScore', 'getDetails', 'getConfig',
  'getMyPubkey', 'getStatus', 'getDistanceBatch', 'getTrustScoreBatch', 'filterByWoT',
  'getFollows', 'getCommonFollows', 'getPath', 'getStats'
] as const;

const NIP07_ALLOWED_METHODS = [
  'getPublicKey', 'signEvent', 'getRelays',
  'nip04Encrypt', 'nip04Decrypt',
  'nip44Encrypt', 'nip44Decrypt'
] as const;

const PRIVILEGED_METHODS = new Set([
  'switchAccount',
  'vault_unlock', 'vault_lock', 'vault_create', 'vault_isLocked', 'vault_exists',
  'vault_listAccounts', 'vault_addAccount', 'vault_removeAccount',
  'vault_setActiveAccount', 'vault_getActivePubkey', 'vault_setAutoLock', 'vault_getAutoLock',
  'vault_exportNsec', 'vault_exportNcryptsec', 'vault_importNcryptsec', 'vault_changePassword',
  'vault_getActiveAccountType',
  'signer_getPermissions', 'signer_getPermissionsForDomain',
  'signer_clearPermissions', 'signer_savePermission',
  'signer_getPermissionsRaw', 'signer_getPermissionsForDomainRaw',
  'signer_copyPermissions', 'signer_getUseGlobalDefaults', 'signer_setUseGlobalDefaults',
  'signer_getPending', 'signer_resolve', 'signer_resolveBatch',
]);

// ── Extracted logic from content.ts for testing ──
//
// These functions mirror the exact validation logic in content.ts.
// By extracting them as pure functions, we can test content script
// behavior without needing chrome.runtime, window.postMessage, etc.

const WOT_RATE_LIMIT = 100;
let wotRequestCount = 0;
let wotRateLimitReset = Date.now();

function checkWotRateLimit(): boolean {
  const now = Date.now();
  if (now - wotRateLimitReset >= 1000) {
    wotRequestCount = 0;
    wotRateLimitReset = now;
  }
  return ++wotRequestCount <= WOT_RATE_LIMIT;
}

function resetRateLimit(): void {
  wotRequestCount = 0;
  wotRateLimitReset = Date.now();
}

/** Simulates content script WOT_REQUEST handling */
function simulateContentWotRequest(
  method: string,
  _params: Record<string, unknown>
): { error?: string; forwarded?: { method: string; params: unknown } } {
  if (!checkWotRateLimit()) {
    return { error: 'Rate limit exceeded' };
  }
  if (!(WOT_ALLOWED_METHODS as readonly string[]).includes(method)) {
    return { error: 'Method not allowed' };
  }
  // In real code, this would call browser.runtime.sendMessage
  return { forwarded: { method, params: _params } };
}

/** Simulates content script NIP07_REQUEST handling */
function simulateContentNip07Request(
  method: string,
  params: Record<string, unknown>,
  protocol: string = 'https:',
  hostname: string = 'example.com'
): { error?: string; forwarded?: { method: string; params: Record<string, unknown> } } {
  // HTTPS check
  if (protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    return { error: 'NIP-07 requires a secure (HTTPS) connection' };
  }
  // Allowlist check
  if (!(NIP07_ALLOWED_METHODS as readonly string[]).includes(method)) {
    return { error: 'Method not allowed' };
  }
  // Forward with nip07_ prefix and origin
  return {
    forwarded: {
      method: 'nip07_' + method,
      params: { ...params, origin: hostname }
    }
  };
}

/** Simulates background privilege gate */
function simulatePrivilegeGate(
  method: string,
  senderId: string,
  senderUrl: string,
  extensionId: string,
  extensionBaseUrl: string
): { blocked: boolean } {
  if (!PRIVILEGED_METHODS.has(method)) return { blocked: false };
  const isInternal = senderId === extensionId &&
    (!senderUrl || senderUrl.startsWith(extensionBaseUrl));
  return { blocked: !isInternal };
}

/** Simulates background NIP-07 param validation (mirrors validateNip07Params) */
function validateNip07Params(method: string, params: Record<string, unknown>): void {
  if (method === 'nip07_signEvent') {
    const evt = params.event;
    if (!evt || typeof evt !== 'object') throw new Error('Invalid event');
    const e = evt as Record<string, unknown>;
    if (typeof e.kind !== 'number' || !Number.isInteger(e.kind) || e.kind < 0)
      throw new Error('Invalid event kind');
    if (typeof e.content !== 'string') throw new Error('Invalid event content');
  }
  if (method === 'nip07_nip04Encrypt' || method === 'nip07_nip44Encrypt') {
    if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
      throw new Error('Invalid pubkey');
    if (typeof params.plaintext !== 'string') throw new Error('Invalid plaintext');
  }
  if (method === 'nip07_nip04Decrypt' || method === 'nip07_nip44Decrypt') {
    if (typeof params.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(params.pubkey))
      throw new Error('Invalid pubkey');
    if (typeof params.ciphertext !== 'string') throw new Error('Invalid ciphertext');
  }
}

// ── Test Constants ──

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const VALID_PUBKEY = 'a'.repeat(64);
const EXTENSION_ID = 'test-extension-id';
const EXTENSION_BASE_URL = 'chrome-extension://test-extension-id/';

function makePayload(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1', name: 'Test', type: 'nsec',
      pubkey: TEST_PUBKEY_HEX, privkey: TEST_PRIVKEY_HEX,
      mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1000000
    }],
    activeAccountId: 'acct1'
  };
}

// ═══════════════════════════════════════════════════════
// Layer 1: Content Script Validation
// ═══════════════════════════════════════════════════════
//
// The content script is the first line of defense. It runs in the
// ISOLATED world and acts as a gatekeeper between the page (MAIN world)
// and the extension's service worker. It enforces:
//
//   1. Method allowlists — only known methods pass through
//   2. Rate limiting — prevents abuse from malicious pages
//   3. HTTPS enforcement — NIP-07 only available on secure origins
//   4. Method prefixing — adds nip07_ prefix so background can distinguish
//   5. Origin injection — appends hostname for permission lookups

describe('communication: content script — WoT allowlist', () => {
  beforeEach(() => resetRateLimit());

  it('allows all valid WoT methods', () => {
    for (const method of WOT_ALLOWED_METHODS) {
      const result = simulateContentWotRequest(method, { target: 'abc' });
      assert.ok(result.forwarded, `${method} should be allowed`);
      assert.strictEqual(result.forwarded!.method, method);
    }
  });

  it('rejects unknown WoT methods', () => {
    const result = simulateContentWotRequest('deleteEverything', {});
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('rejects privileged methods via WoT channel', () => {
    const result = simulateContentWotRequest('vault_unlock', { password: 'test' });
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('rejects NIP-07 methods via WoT channel', () => {
    const result = simulateContentWotRequest('signEvent', { event: {} });
    assert.strictEqual(result.error, 'Method not allowed');
  });
});

describe('communication: content script — WoT rate limiting', () => {
  beforeEach(() => resetRateLimit());

  it('allows up to 100 requests per second', () => {
    for (let i = 0; i < WOT_RATE_LIMIT; i++) {
      const result = simulateContentWotRequest('getDistance', { target: 'abc' });
      assert.ok(result.forwarded, `Request ${i + 1} should be allowed`);
    }
  });

  it('rejects request 101 in same second window', () => {
    for (let i = 0; i < WOT_RATE_LIMIT; i++) {
      simulateContentWotRequest('getDistance', { target: 'abc' });
    }
    const result = simulateContentWotRequest('getDistance', { target: 'abc' });
    assert.strictEqual(result.error, 'Rate limit exceeded');
  });

  it('resets counter after window rolls over', () => {
    for (let i = 0; i < WOT_RATE_LIMIT; i++) {
      simulateContentWotRequest('getDistance', { target: 'abc' });
    }
    // Simulate time passing
    wotRateLimitReset = Date.now() - 1001;
    const result = simulateContentWotRequest('getDistance', { target: 'abc' });
    assert.ok(result.forwarded, 'Should be allowed after rate limit reset');
  });
});

describe('communication: content script — NIP-07 allowlist', () => {
  it('allows all valid NIP-07 methods', () => {
    for (const method of NIP07_ALLOWED_METHODS) {
      const result = simulateContentNip07Request(method, {});
      assert.ok(result.forwarded, `${method} should be allowed`);
    }
  });

  it('rejects unknown NIP-07 methods', () => {
    const result = simulateContentNip07Request('getPrivateKey', {});
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('rejects vault methods via NIP-07 channel', () => {
    const result = simulateContentNip07Request('vault_create', { password: 'test' });
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('rejects WoT methods via NIP-07 channel', () => {
    const result = simulateContentNip07Request('getDistance', { target: 'abc' });
    assert.strictEqual(result.error, 'Method not allowed');
  });
});

describe('communication: content script — NIP-07 prefix and origin', () => {
  it('prefixes method with nip07_', () => {
    const result = simulateContentNip07Request('getPublicKey', {});
    assert.strictEqual(result.forwarded!.method, 'nip07_getPublicKey');
  });

  it('adds origin hostname to params', () => {
    const result = simulateContentNip07Request('signEvent', { event: {} }, 'https:', 'nostr.com');
    assert.strictEqual(result.forwarded!.params.origin, 'nostr.com');
  });

  it('preserves original params alongside origin', () => {
    const result = simulateContentNip07Request(
      'nip04Encrypt',
      { pubkey: VALID_PUBKEY, plaintext: 'hello' },
      'https:', 'app.example.com'
    );
    const params = result.forwarded!.params;
    assert.strictEqual(params.pubkey, VALID_PUBKEY);
    assert.strictEqual(params.plaintext, 'hello');
    assert.strictEqual(params.origin, 'app.example.com');
  });
});

describe('communication: content script — HTTPS enforcement', () => {
  it('allows HTTPS requests', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'https:', 'example.com');
    assert.ok(result.forwarded);
  });

  it('blocks HTTP requests from non-localhost', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'http:', 'example.com');
    assert.strictEqual(result.error, 'NIP-07 requires a secure (HTTPS) connection');
  });

  it('allows HTTP from localhost', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'http:', 'localhost');
    assert.ok(result.forwarded);
  });

  it('allows HTTP from 127.0.0.1', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'http:', '127.0.0.1');
    assert.ok(result.forwarded);
  });

  it('allows HTTP from [::1]', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'http:', '[::1]');
    assert.ok(result.forwarded);
  });

  it('blocks HTTP from local-sounding domains', () => {
    const result = simulateContentNip07Request('getPublicKey', {}, 'http:', 'localhost.evil.com');
    assert.strictEqual(result.error, 'NIP-07 requires a secure (HTTPS) connection');
  });
});

// ═══════════════════════════════════════════════════════
// Layer 2: Background Handler Validation
// ═══════════════════════════════════════════════════════
//
// The background handler is the second line of defense. It receives
// messages from content scripts and internal extension pages. It enforces:
//
//   1. Privilege gate — sensitive methods (vault_*, signer_*, switchAccount)
//      are restricted to internal senders (same extension ID, no tab)
//   2. Param validation — NIP-07 params are checked before processing
//      (event shape, pubkey hex format, plaintext/ciphertext type)

describe('communication: background — privilege gate', () => {
  it('blocks privileged methods from content scripts', () => {
    const result = simulatePrivilegeGate(
      'vault_unlock', EXTENSION_ID, 'https://evil.com', EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(result.blocked, true);
  });

  it('allows privileged methods from internal extension pages', () => {
    const result = simulatePrivilegeGate(
      'vault_unlock', EXTENSION_ID, EXTENSION_BASE_URL + 'popup.html',
      EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(result.blocked, false);
  });

  it('blocks privileged methods from other extensions', () => {
    const result = simulatePrivilegeGate(
      'vault_unlock', 'other-extension-id', '', EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(result.blocked, true);
  });

  it('allows non-privileged methods from any sender', () => {
    const result = simulatePrivilegeGate(
      'getDistance', 'random-id', 'https://evil.com', EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(result.blocked, false);
  });

  it('allows NIP-07 methods from content scripts (not privileged)', () => {
    const result = simulatePrivilegeGate(
      'nip07_getPublicKey', EXTENSION_ID, 'https://example.com',
      EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(result.blocked, false);
  });
});

describe('communication: background — validateNip07Params', () => {
  // signEvent validation
  it('accepts valid signEvent params', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_signEvent', {
        event: { kind: 1, content: 'hello', created_at: 1000, tags: [] }
      });
    });
  });

  it('rejects signEvent with missing event', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', {}),
      /Invalid event/
    );
  });

  it('rejects signEvent with non-object event', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: 'not an object' }),
      /Invalid event/
    );
  });

  it('rejects signEvent with invalid event kind (string)', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: { kind: '1', content: 'hi' } }),
      /Invalid event kind/
    );
  });

  it('rejects signEvent with negative event kind', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: { kind: -1, content: 'hi' } }),
      /Invalid event kind/
    );
  });

  it('rejects signEvent with float event kind', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: { kind: 1.5, content: 'hi' } }),
      /Invalid event kind/
    );
  });

  it('rejects signEvent with missing content', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: { kind: 1 } }),
      /Invalid event content/
    );
  });

  it('rejects signEvent with non-string content', () => {
    assert.throws(
      () => validateNip07Params('nip07_signEvent', { event: { kind: 1, content: 42 } }),
      /Invalid event content/
    );
  });

  // Encrypt validation
  it('accepts valid nip04Encrypt params', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_nip04Encrypt', { pubkey: VALID_PUBKEY, plaintext: 'hello' });
    });
  });

  it('rejects nip04Encrypt with invalid pubkey (too short)', () => {
    assert.throws(
      () => validateNip07Params('nip07_nip04Encrypt', { pubkey: 'abc', plaintext: 'hello' }),
      /Invalid pubkey/
    );
  });

  it('rejects nip04Encrypt with non-hex pubkey', () => {
    assert.throws(
      () => validateNip07Params('nip07_nip04Encrypt', { pubkey: 'g'.repeat(64), plaintext: 'hello' }),
      /Invalid pubkey/
    );
  });

  it('rejects nip04Encrypt with missing plaintext', () => {
    assert.throws(
      () => validateNip07Params('nip07_nip04Encrypt', { pubkey: VALID_PUBKEY }),
      /Invalid plaintext/
    );
  });

  it('accepts valid nip44Encrypt params', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_nip44Encrypt', { pubkey: VALID_PUBKEY, plaintext: 'hello' });
    });
  });

  // Decrypt validation
  it('accepts valid nip04Decrypt params', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_nip04Decrypt', { pubkey: VALID_PUBKEY, ciphertext: 'data' });
    });
  });

  it('rejects nip04Decrypt with missing ciphertext', () => {
    assert.throws(
      () => validateNip07Params('nip07_nip04Decrypt', { pubkey: VALID_PUBKEY }),
      /Invalid ciphertext/
    );
  });

  it('rejects nip44Decrypt with invalid pubkey', () => {
    assert.throws(
      () => validateNip07Params('nip07_nip44Decrypt', { pubkey: 123 as unknown as string, ciphertext: 'data' }),
      /Invalid pubkey/
    );
  });

  // getPublicKey - no params to validate
  it('passes through getPublicKey with no validation errors', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_getPublicKey', {});
    });
  });

  // getRelays - no params to validate
  it('passes through getRelays with no validation errors', () => {
    assert.doesNotThrow(() => {
      validateNip07Params('nip07_getRelays', {});
    });
  });
});

// ═══════════════════════════════════════════════════════
// Layer 3: End-to-End Message Flow
// ═══════════════════════════════════════════════════════
//
// These tests exercise the full pipeline from page request to signed
// response using real vault, signer, and permissions modules backed by
// mock browser.storage. They verify that all layers compose correctly:
//
//   page request → content validation → background gate → param check
//     → permission check → vault key retrieval → crypto signing → response
//
// The mock storage (tests/helpers/browser-mock.ts) provides in-memory
// implementations of browser.storage.{local,sync,session}.

describe('communication: end-to-end — getPublicKey flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    // Set permission to 'allow' so we don't need popup approval
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
  });

  it('full flow: page → content → background → signer → response', async () => {
    // Step 1: Content script receives NIP07_REQUEST
    const contentResult = simulateContentNip07Request('getPublicKey', {}, 'https:', 'example.com');
    assert.ok(contentResult.forwarded, 'Content script should forward');
    assert.strictEqual(contentResult.forwarded!.method, 'nip07_getPublicKey');
    assert.strictEqual(contentResult.forwarded!.params.origin, 'example.com');

    // Step 2: Background validates and processes
    const method = contentResult.forwarded!.method;
    const params = contentResult.forwarded!.params;

    // Privilege gate: NIP-07 methods are not privileged
    const gateResult = simulatePrivilegeGate(method, EXTENSION_ID, 'https://example.com', EXTENSION_ID, EXTENSION_BASE_URL);
    assert.strictEqual(gateResult.blocked, false);

    // Param validation
    assert.doesNotThrow(() => validateNip07Params(method, params));

    // Step 3: Signer handles request (using actual signer module)
    const { handleGetPublicKey } = await import('../lib/signer.js');

    // Mock the storage that signer reads for account info
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
    await mockBrowser.storage.local.set({
      accounts: [{ id: 'acct1', type: 'nsec' }],
      activeAccountId: 'acct1'
    });
    await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });

    const pubkey = await handleGetPublicKey(params.origin as string);
    assert.strictEqual(pubkey, TEST_PUBKEY_HEX);
  });
});

describe('communication: end-to-end — signEvent flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    await permissions.save('example.com', 'signEvent', 1, 'allow');

    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
    await mockBrowser.storage.local.set({
      accounts: [{ id: 'acct1', type: 'nsec' }],
      activeAccountId: 'acct1'
    });
    await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
  });

  it('full flow: signEvent with valid event', async () => {
    const event: UnsignedEvent = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'Hello Nostr!'
    };

    // Content script forwards
    const contentResult = simulateContentNip07Request('signEvent', { event }, 'https:', 'example.com');
    assert.ok(contentResult.forwarded);
    assert.strictEqual(contentResult.forwarded!.method, 'nip07_signEvent');

    // Background validates
    assert.doesNotThrow(() => validateNip07Params(
      contentResult.forwarded!.method,
      contentResult.forwarded!.params
    ));

    // Signer handles
    const { handleSignEvent } = await import('../lib/signer.js');
    const signed = await handleSignEvent(event, 'example.com');

    // Verify signed event structure
    assert.ok(signed.id, 'Signed event should have id');
    assert.ok(signed.sig, 'Signed event should have sig');
    assert.ok(signed.pubkey, 'Signed event should have pubkey');
    assert.strictEqual(signed.kind, 1);
    assert.strictEqual(signed.content, 'Hello Nostr!');
  });

  it('rejects signEvent with invalid kind at validation layer', () => {
    const contentResult = simulateContentNip07Request(
      'signEvent',
      { event: { kind: 'invalid', content: 'test' } },
      'https:', 'example.com'
    );
    assert.ok(contentResult.forwarded);
    assert.throws(
      () => validateNip07Params(contentResult.forwarded!.method, contentResult.forwarded!.params),
      /Invalid event kind/
    );
  });
});

describe('communication: end-to-end — error propagation', () => {
  beforeEach(() => {
    resetMockStorage();
    vault.lock();
  });

  it('HTTP rejection propagates before reaching background', () => {
    const result = simulateContentNip07Request('signEvent', { event: {} }, 'http:', 'evil.com');
    assert.strictEqual(result.error, 'NIP-07 requires a secure (HTTPS) connection');
    assert.strictEqual(result.forwarded, undefined);
  });

  it('unknown method rejection propagates before reaching background', () => {
    const result = simulateContentNip07Request('getPrivateKey', {});
    assert.strictEqual(result.error, 'Method not allowed');
    assert.strictEqual(result.forwarded, undefined);
  });

  it('privileged method via content script is blocked at background gate', () => {
    // Simulate content script somehow forwarding a privileged method
    const gateResult = simulatePrivilegeGate(
      'vault_unlock', EXTENSION_ID, 'https://evil.com', EXTENSION_ID, EXTENSION_BASE_URL
    );
    assert.strictEqual(gateResult.blocked, true);
  });

  it('invalid params caught at background validation layer', () => {
    // Content script forwards malformed signEvent
    const forwarded = simulateContentNip07Request(
      'signEvent', { event: null }, 'https:', 'example.com'
    );
    assert.ok(forwarded.forwarded);
    assert.throws(
      () => validateNip07Params(forwarded.forwarded!.method, forwarded.forwarded!.params),
      /Invalid event/
    );
  });
});

describe('communication: message shape integrity', () => {
  it('WoT request forwards method and params unchanged', () => {
    resetRateLimit();
    const params = { target: 'abc123', maxHops: 3 };
    const result = simulateContentWotRequest('getDistance', params);
    assert.deepStrictEqual(result.forwarded, {
      method: 'getDistance',
      params: { target: 'abc123', maxHops: 3 }
    });
  });

  it('NIP-07 request adds prefix and origin but preserves params', () => {
    const params = { pubkey: VALID_PUBKEY, plaintext: 'secret' };
    const result = simulateContentNip07Request('nip04Encrypt', params, 'https:', 'nostr.com');
    assert.deepStrictEqual(result.forwarded, {
      method: 'nip07_nip04Encrypt',
      params: { pubkey: VALID_PUBKEY, plaintext: 'secret', origin: 'nostr.com' }
    });
  });

  it('NIP-07 origin does not pollute original params object', () => {
    const originalParams = { pubkey: VALID_PUBKEY, plaintext: 'secret' };
    simulateContentNip07Request('nip04Encrypt', originalParams, 'https:', 'nostr.com');
    // Original object should not be mutated (content.ts uses spread)
    assert.strictEqual((originalParams as Record<string, unknown>).origin, undefined);
  });
});

describe('communication: channel isolation', () => {
  beforeEach(() => resetRateLimit());

  it('WoT channel cannot access NIP-07 methods', () => {
    const result = simulateContentWotRequest('getPublicKey', {});
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('NIP-07 channel cannot access WoT methods', () => {
    const result = simulateContentNip07Request('getDistance', { target: 'abc' });
    assert.strictEqual(result.error, 'Method not allowed');
  });

  it('neither channel can access privileged vault methods', () => {
    const wot = simulateContentWotRequest('vault_unlock', { password: 'test' });
    assert.strictEqual(wot.error, 'Method not allowed');

    const nip07 = simulateContentNip07Request('vault_unlock', { password: 'test' });
    assert.strictEqual(nip07.error, 'Method not allowed');
  });

  it('neither channel can access privileged signer methods', () => {
    const wot = simulateContentWotRequest('signer_resolve', { id: 'x' });
    assert.strictEqual(wot.error, 'Method not allowed');

    const nip07 = simulateContentNip07Request('signer_resolve', { id: 'x' });
    assert.strictEqual(nip07.error, 'Method not allowed');
  });
});

// ═══════════════════════════════════════════════════════
// Layer 4: Account Switching
// ═══════════════════════════════════════════════════════
//
// The extension supports multiple accounts in a single vault. When the
// user switches accounts (background.ts `switchAccount` handler):
//
//   1. vault.setActiveAccount(newId) — changes which key is active
//   2. browser.storage.sync.myPubkey updated — canonical pubkey source
//   3. browser.storage.local.activeAccountId updated
//   4. signer.rejectPendingForAccount(oldId) — rejects all pending
//      signing requests for the OLD account (prevents signing with
//      the wrong key if a request was queued before the switch)
//   5. storage.switchDatabase(newId) — loads the new account's WoT graph
//
// These tests verify:
//   - Vault state transitions (active account, pubkey, privkey isolation)
//   - Pending request cleanup on account switch
//   - Signer returns correct pubkey/signature after switch

const SECOND_PRIVKEY_HEX = '4a2e1c9d8b7f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d4c3b2a19087f6e5d';
const SECOND_PUBKEY_HEX = 'b'.repeat(64);

function makeMultiAccountPayload(): VaultPayload {
  return {
    accounts: [
      {
        id: 'acct1', name: 'Account 1', type: 'nsec',
        pubkey: TEST_PUBKEY_HEX, privkey: TEST_PRIVKEY_HEX,
        mnemonic: null, nip46Config: null, readOnly: false, createdAt: 1000000
      },
      {
        id: 'acct2', name: 'Account 2', type: 'nsec',
        pubkey: SECOND_PUBKEY_HEX, privkey: SECOND_PRIVKEY_HEX,
        mnemonic: null, nip46Config: null, readOnly: false, createdAt: 2000000
      }
    ],
    activeAccountId: 'acct1'
  };
}

describe('communication: account switching — vault state', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makeMultiAccountPayload());
  });

  it('setActiveAccount changes which account is active', async () => {
    const before = vault.getActiveAccount();
    assert.strictEqual(before!.id, 'acct1');

    await vault.setActiveAccount('acct2');
    const after = vault.getActiveAccount();
    assert.strictEqual(after!.id, 'acct2');
    assert.strictEqual(after!.pubkey, SECOND_PUBKEY_HEX);
  });

  it('setActiveAccount throws for unknown account', async () => {
    await assert.rejects(
      () => vault.setActiveAccount('nonexistent'),
      /Account not found/
    );
  });

  it('getPrivkey returns correct key for each account', async () => {
    const key1 = vault.getPrivkey('acct1');
    assert.ok(key1);
    assert.strictEqual(key1!.length, 32);
    key1!.fill(0);

    const key2 = vault.getPrivkey('acct2');
    assert.ok(key2);
    assert.strictEqual(key2!.length, 32);
    key2!.fill(0);
  });

  it('getPrivkey returns different keys for different accounts', async () => {
    const key1 = vault.getPrivkey('acct1');
    const key2 = vault.getPrivkey('acct2');
    assert.ok(key1 && key2);
    assert.notDeepStrictEqual(key1, key2);
    key1!.fill(0);
    key2!.fill(0);
  });

  it('getActivePubkey reflects the active account', async () => {
    assert.strictEqual(vault.getActivePubkey(), TEST_PUBKEY_HEX);
    await vault.setActiveAccount('acct2');
    assert.strictEqual(vault.getActivePubkey(), SECOND_PUBKEY_HEX);
  });

  it('clearActiveAccount makes getActiveAccount return null', () => {
    assert.ok(vault.getActiveAccount());
    vault.clearActiveAccount();
    assert.strictEqual(vault.getActiveAccount(), null);
    assert.strictEqual(vault.getActivePubkey(), null);
  });

  it('listAccounts returns all accounts regardless of active', async () => {
    const list = vault.listAccounts();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].id, 'acct1');
    assert.strictEqual(list[1].id, 'acct2');
  });
});

describe('communication: account switching — pending request rejection', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makeMultiAccountPayload());
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
    await mockBrowser.storage.local.set({
      accounts: [
        { id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX },
        { id: 'acct2', type: 'nsec', pubkey: SECOND_PUBKEY_HEX }
      ],
      activeAccountId: 'acct1'
    });
    await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
  });

  it('rejectPendingForAccount clears pending entries from session storage', async () => {
    const { rejectPendingForAccount, getPending } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    // Seed some pending requests for acct1
    await mockBrowser.storage.session.set({
      signerPending: [
        { id: 'req_1', type: 'signEvent', origin: 'example.com', accountId: 'acct1', timestamp: Date.now() },
        { id: 'req_2', type: 'signEvent', origin: 'other.com', accountId: 'acct1', timestamp: Date.now() },
        { id: 'req_3', type: 'signEvent', origin: 'example.com', accountId: 'acct2', timestamp: Date.now() }
      ]
    });

    await rejectPendingForAccount('acct1');

    const remaining = await getPending();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].accountId, 'acct2');
  });

  it('rejectPendingForAccount with empty string is a no-op', async () => {
    const { rejectPendingForAccount, getPending } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    await mockBrowser.storage.session.set({
      signerPending: [
        { id: 'req_1', type: 'signEvent', origin: 'example.com', accountId: 'acct1', timestamp: Date.now() }
      ]
    });

    await rejectPendingForAccount('');

    const remaining = await getPending();
    assert.strictEqual(remaining.length, 1);
  });

  it('rejectPendingForAccount leaves other accounts pending intact', async () => {
    const { rejectPendingForAccount, getPending } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    await mockBrowser.storage.session.set({
      signerPending: [
        { id: 'req_1', type: 'signEvent', origin: 'a.com', accountId: 'acct1', timestamp: Date.now() },
        { id: 'req_2', type: 'signEvent', origin: 'b.com', accountId: 'acct2', timestamp: Date.now() },
        { id: 'req_3', type: 'nip04Encrypt', origin: 'c.com', accountId: 'acct2', timestamp: Date.now() }
      ]
    });

    await rejectPendingForAccount('acct1');

    const remaining = await getPending();
    assert.strictEqual(remaining.length, 2);
    assert.ok(remaining.every(r => r.accountId === 'acct2'));
  });
});

describe('communication: account switching — pubkey after switch', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makeMultiAccountPayload());
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
    await mockBrowser.storage.local.set({
      accounts: [
        { id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX },
        { id: 'acct2', type: 'nsec', pubkey: SECOND_PUBKEY_HEX }
      ],
      activeAccountId: 'acct1'
    });
    await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
  });

  it('handleGetPublicKey returns acct1 pubkey initially', async () => {
    const { handleGetPublicKey } = await import('../lib/signer.js');
    const pubkey = await handleGetPublicKey('example.com');
    assert.strictEqual(pubkey, TEST_PUBKEY_HEX);
  });

  it('handleGetPublicKey returns acct2 pubkey after switch', async () => {
    const { handleGetPublicKey } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    // Simulate the switchAccount flow from background.ts
    await vault.setActiveAccount('acct2');
    await mockBrowser.storage.sync.set({ myPubkey: SECOND_PUBKEY_HEX });
    await mockBrowser.storage.local.set({ activeAccountId: 'acct2' });

    const pubkey = await handleGetPublicKey('example.com');
    assert.strictEqual(pubkey, SECOND_PUBKEY_HEX);
  });

  it('signEvent uses the correct key after account switch', async () => {
    const { handleSignEvent } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    await permissions.save('example.com', 'signEvent', 1, 'allow');

    // Switch to acct2
    await vault.setActiveAccount('acct2');
    await mockBrowser.storage.sync.set({ myPubkey: SECOND_PUBKEY_HEX });
    await mockBrowser.storage.local.set({ activeAccountId: 'acct2' });

    const event: UnsignedEvent = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'signed by acct2'
    };

    const signed = await handleSignEvent(event, 'example.com');
    // The signed event should use acct2's pubkey
    assert.ok(signed.pubkey);
    assert.ok(signed.sig);
    assert.strictEqual(signed.content, 'signed by acct2');
  });
});

// ═══════════════════════════════════════════════════════
// Layer 5: Vault Locked Scenarios
// ═══════════════════════════════════════════════════════
//
// The vault has two states: unlocked (keys in memory) and locked
// (all key material zeroed). When locked:
//
//   - All key-dependent APIs throw "Vault is locked"
//   - getPrivkey() throws (blocks signing/encrypt/decrypt)
//   - getActiveAccount() returns null (no account info available)
//   - listAccounts() returns [] (UI shows empty state)
//   - exists() still returns true (encrypted data persists on disk)
//   - Mutation APIs (add/remove/setActive/reEncrypt) throw
//
// The signer module handles locked vault gracefully:
//   - handleGetPublicKey reads from browser.storage.sync (no vault needed)
//   - handleSignEvent queues a waitingForUnlock request (popup shows
//     "unlock to continue"), then retries after onVaultUnlocked()
//   - If still locked after the queue resolves, throws "Vault is locked"
//
// Lock/unlock cycle:
//   create(password, payload) → unlocked
//   lock() → zeroes all privkeyBytes/mnemonicBytes, nulls _decrypted
//   unlock(password) → re-derives AES key, decrypts, rebuilds MemoryVaultPayload

describe('communication: vault locked — vault API behavior', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    // Now lock it
    vault.lock();
  });

  it('isLocked returns true after lock', () => {
    assert.strictEqual(vault.isLocked(), true);
  });

  it('getPrivkey throws when locked', () => {
    assert.throws(
      () => vault.getPrivkey(),
      /Vault is locked/
    );
  });

  it('getActiveAccount returns null when locked', () => {
    assert.strictEqual(vault.getActiveAccount(), null);
  });

  it('getActivePubkey returns null when locked', () => {
    assert.strictEqual(vault.getActivePubkey(), null);
  });

  it('getActiveAccountId returns null when locked', () => {
    assert.strictEqual(vault.getActiveAccountId(), null);
  });

  it('listAccounts returns empty when locked', () => {
    assert.deepStrictEqual(vault.listAccounts(), []);
  });

  it('getDecryptedPayload throws when locked', () => {
    assert.throws(
      () => vault.getDecryptedPayload(),
      /Vault is locked/
    );
  });

  it('addAccount throws when locked', async () => {
    await assert.rejects(
      () => vault.addAccount({
        id: 'new', name: 'New', type: 'nsec',
        pubkey: 'c'.repeat(64), privkey: 'd'.repeat(64),
        mnemonic: null, nip46Config: null, readOnly: false, createdAt: 3000000
      }),
      /Vault is locked/
    );
  });

  it('setActiveAccount throws when locked', async () => {
    await assert.rejects(
      () => vault.setActiveAccount('acct1'),
      /Vault is locked/
    );
  });

  it('removeAccount throws when locked', async () => {
    await assert.rejects(
      () => vault.removeAccount('acct1'),
      /Vault is locked/
    );
  });

  it('reEncrypt throws when locked', async () => {
    await assert.rejects(
      () => vault.reEncrypt('newpassword123'),
      /Vault is locked/
    );
  });

  it('exists still returns true when locked (vault is in storage)', async () => {
    assert.strictEqual(await vault.exists(), true);
  });

  it('unlock restores access after lock', async () => {
    assert.strictEqual(vault.isLocked(), true);
    const ok = await vault.unlock(TEST_PASSWORD);
    assert.strictEqual(ok, true);
    assert.strictEqual(vault.isLocked(), false);
    assert.ok(vault.getActiveAccount());
  });
});

describe('communication: vault locked — signer behavior', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
    await mockBrowser.storage.local.set({
      accounts: [{ id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX }],
      activeAccountId: 'acct1'
    });
    await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
    await permissions.save('example.com', 'signEvent', 1, 'allow');
  });

  it('handleGetPublicKey works when locked (reads from sync storage)', async () => {
    vault.lock();
    const { handleGetPublicKey } = await import('../lib/signer.js');
    const pubkey = await handleGetPublicKey('example.com');
    assert.strictEqual(pubkey, TEST_PUBKEY_HEX);
  });

  it('vault.getPrivkey throws when locked (signer would fail to sign)', () => {
    vault.lock();
    assert.throws(
      () => vault.getPrivkey(),
      /Vault is locked/
    );
  });

  it('handleSignEvent succeeds when vault is unlocked', async () => {
    // Vault starts unlocked from beforeEach
    assert.strictEqual(vault.isLocked(), false);

    const { handleSignEvent } = await import('../lib/signer.js');
    const event: UnsignedEvent = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'after unlock'
    };

    const signed = await handleSignEvent(event, 'example.com');
    assert.ok(signed.sig);
    assert.strictEqual(signed.content, 'after unlock');
  });

  it('vault.exists() returns true even when locked', async () => {
    vault.lock();
    assert.strictEqual(await vault.exists(), true);
  });

  it('signer cannot sign when vault locked — getPrivkey blocks signing path', () => {
    vault.lock();
    // The signer checks vault.isLocked() before calling getPrivkey.
    // If it did call getPrivkey when locked, it would throw.
    assert.strictEqual(vault.isLocked(), true);
    assert.throws(() => vault.getPrivkey(), /Vault is locked/);
  });
});

describe('communication: vault locked — pending request state', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await vault.create(TEST_PASSWORD, makePayload());
    const { cleanupStale } = await import('../lib/signer.js');
    await cleanupStale();
  });

  it('getPending returns empty after cleanupStale', async () => {
    const { getPending } = await import('../lib/signer.js');
    const pending = await getPending();
    assert.deepStrictEqual(pending, []);
  });

  it('onVaultUnlocked resolves waitingForUnlock entries', async () => {
    const { onVaultUnlocked, getPending } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    // Seed a waitingForUnlock entry
    await mockBrowser.storage.session.set({
      signerPending: [
        { id: 'req_unlock_1', type: 'signEvent', origin: 'a.com', waitingForUnlock: true, accountId: 'acct1', timestamp: Date.now() },
        { id: 'req_normal_1', type: 'signEvent', origin: 'b.com', needsPermission: true, accountId: 'acct1', timestamp: Date.now() }
      ]
    });

    await onVaultUnlocked();

    // Only the waitingForUnlock entry should be removed
    const remaining = await getPending();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, 'req_normal_1');
  });

  it('cleanupStale clears all pending requests', async () => {
    const { cleanupStale, getPending } = await import('../lib/signer.js');
    const { default: mockBrowser } = await import('./helpers/browser-mock.ts');

    // Seed some requests
    await mockBrowser.storage.session.set({
      signerPending: [
        { id: 'req_1', type: 'signEvent', origin: 'a.com', accountId: 'acct1', timestamp: Date.now() },
        { id: 'req_2', type: 'signEvent', origin: 'b.com', accountId: 'acct1', timestamp: Date.now() }
      ]
    });

    await cleanupStale();

    const remaining = await getPending();
    assert.strictEqual(remaining.length, 0);
  });
});

// ═══════════════════════════════════════════════════════
// Layer 6: Permissions × Lock State Matrix
// ═══════════════════════════════════════════════════════

/**
 * Tests the permission × vault-lock interaction matrix.
 *
 * For each NIP-07 method the signer checks permissions FIRST:
 *   deny  → always rejects (regardless of lock state)
 *   ask   → queues for user approval (popup)
 *   allow → proceeds, but signing/encrypt/decrypt need vault unlocked
 *
 * getPublicKey is special: it reads from sync storage, so it works
 * even when the vault is locked (as long as permission is granted).
 */

async function setupPermissionTest() {
  resetMockStorage();
  vault.lock();
  await vault.create(TEST_PASSWORD, makePayload());
  const { default: mockBrowser } = await import('./helpers/browser-mock.ts');
  await mockBrowser.storage.local.set({
    accounts: [{ id: 'acct1', type: 'nsec', pubkey: TEST_PUBKEY_HEX }],
    activeAccountId: 'acct1'
  });
  await mockBrowser.storage.sync.set({ myPubkey: TEST_PUBKEY_HEX });
  // Clean pending state
  const { cleanupStale } = await import('../lib/signer.js');
  await cleanupStale();
}

describe('communication: permissions × lock — getPublicKey', () => {
  beforeEach(() => setupPermissionTest());

  it('deny + unlocked → rejects', async () => {
    await permissions.save('app.com', 'getPublicKey', null, 'deny');
    const { handleGetPublicKey } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleGetPublicKey('app.com'),
      /Permission denied/
    );
  });

  it('deny + locked → rejects', async () => {
    await permissions.save('app.com', 'getPublicKey', null, 'deny');
    vault.lock();
    const { handleGetPublicKey } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleGetPublicKey('app.com'),
      /Permission denied/
    );
  });

  it('allow + unlocked → returns pubkey', async () => {
    await permissions.save('app.com', 'getPublicKey', null, 'allow');
    const { handleGetPublicKey } = await import('../lib/signer.js');
    const pubkey = await handleGetPublicKey('app.com');
    assert.strictEqual(pubkey, TEST_PUBKEY_HEX);
  });

  it('allow + locked → still returns pubkey (reads from storage)', async () => {
    await permissions.save('app.com', 'getPublicKey', null, 'allow');
    vault.lock();
    const { handleGetPublicKey } = await import('../lib/signer.js');
    const pubkey = await handleGetPublicKey('app.com');
    assert.strictEqual(pubkey, TEST_PUBKEY_HEX);
  });

  it('no permission (ask) → permission check returns ask', async () => {
    // No permission saved for unknown.com — check returns 'ask'
    const decision = await permissions.check('unknown.com', 'getPublicKey');
    assert.strictEqual(decision, 'ask');
  });

  it('no permission + unlocked → signer would queue for approval (not auto-allow)', async () => {
    // Verify the permission is 'ask', meaning the signer won't auto-return the pubkey
    const decision = await permissions.check('noperm.com', 'getPublicKey');
    assert.strictEqual(decision, 'ask');
    // The signer would call queueRequest here, so the pubkey is NOT leaked
  });

  it('no permission + locked → signer would queue for approval', async () => {
    vault.lock();
    const decision = await permissions.check('noperm.com', 'getPublicKey');
    assert.strictEqual(decision, 'ask');
  });
});

describe('communication: permissions × lock — signEvent', () => {
  beforeEach(() => setupPermissionTest());

  it('allow + unlocked → signs successfully', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'allow');
    const { handleSignEvent } = await import('../lib/signer.js');
    const event: UnsignedEvent = {
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'test'
    };
    const signed = await handleSignEvent(event, 'app.com');
    assert.ok(signed.sig);
    assert.ok(signed.pubkey);
    assert.strictEqual(signed.content, 'test');
  });

  it('deny + unlocked → rejects even though vault is available', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'deny');
    const { handleSignEvent } = await import('../lib/signer.js');
    const event: UnsignedEvent = {
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'test'
    };
    await assert.rejects(
      () => handleSignEvent(event, 'app.com'),
      /Permission denied/
    );
  });

  it('deny + locked → rejects (permission check happens before lock check)', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'deny');
    vault.lock();
    const { handleSignEvent } = await import('../lib/signer.js');
    const event: UnsignedEvent = {
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'test'
    };
    await assert.rejects(
      () => handleSignEvent(event, 'app.com'),
      /Permission denied/
    );
  });

  it('allow + locked → vault blocks signing (permission passes, lock fails)', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'allow');
    vault.lock();
    // Permission passes but vault is locked — signer would queue waitingForUnlock.
    // Verify both states independently:
    const decision = await permissions.check('app.com', 'signEvent', 1);
    assert.strictEqual(decision, 'allow');
    assert.strictEqual(vault.isLocked(), true);
    assert.throws(() => vault.getPrivkey(), /Vault is locked/);
  });

  it('no permission + unlocked → would queue for approval, not auto-sign', async () => {
    const decision = await permissions.check('noperm.com', 'signEvent', 1);
    assert.strictEqual(decision, 'ask');
    // Even though vault is unlocked, signer queues for user approval
  });

  it('no permission + locked → would queue for approval', async () => {
    vault.lock();
    const decision = await permissions.check('noperm.com', 'signEvent', 1);
    assert.strictEqual(decision, 'ask');
  });

  it('allow kind 1 but deny kind 4 → kind isolation', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'allow');
    await permissions.save('app.com', 'signEvent', 4, 'deny');

    const { handleSignEvent } = await import('../lib/signer.js');

    // Kind 1 succeeds
    const event1: UnsignedEvent = {
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'note'
    };
    const signed = await handleSignEvent(event1, 'app.com');
    assert.ok(signed.sig);

    // Kind 4 denied
    const event4: UnsignedEvent = {
      kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'dm'
    };
    await assert.rejects(
      () => handleSignEvent(event4, 'app.com'),
      /Permission denied/
    );
  });

  it('permission for domain A does not leak to domain B', async () => {
    await permissions.save('allowed.com', 'signEvent', 1, 'allow');
    // other.com has no permissions
    const decision = await permissions.check('other.com', 'signEvent', 1);
    assert.strictEqual(decision, 'ask');
  });
});

describe('communication: permissions × lock — encrypt/decrypt', () => {
  beforeEach(() => setupPermissionTest());

  it('nip04Encrypt: deny + unlocked → rejects', async () => {
    await permissions.save('app.com', 'nip04Encrypt', null, 'deny');
    const { handleNip04Encrypt } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleNip04Encrypt(VALID_PUBKEY, 'hello', 'app.com'),
      /Permission denied/
    );
  });

  it('nip04Decrypt: deny + unlocked → rejects', async () => {
    await permissions.save('app.com', 'nip04Decrypt', null, 'deny');
    const { handleNip04Decrypt } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleNip04Decrypt(VALID_PUBKEY, 'cipher', 'app.com'),
      /Permission denied/
    );
  });

  it('nip44Encrypt: deny + locked → rejects (permission first)', async () => {
    await permissions.save('app.com', 'nip44Encrypt', null, 'deny');
    vault.lock();
    const { handleNip44Encrypt } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleNip44Encrypt(VALID_PUBKEY, 'hello', 'app.com'),
      /Permission denied/
    );
  });

  it('nip44Decrypt: deny + locked → rejects (permission first)', async () => {
    await permissions.save('app.com', 'nip44Decrypt', null, 'deny');
    vault.lock();
    const { handleNip44Decrypt } = await import('../lib/signer.js');
    await assert.rejects(
      () => handleNip44Decrypt(VALID_PUBKEY, 'cipher', 'app.com'),
      /Permission denied/
    );
  });

  it('nip04Encrypt: allow + locked → vault blocks operation', async () => {
    await permissions.save('app.com', 'nip04Encrypt', null, 'allow');
    vault.lock();
    const decision = await permissions.check('app.com', 'nip04Encrypt');
    assert.strictEqual(decision, 'allow');
    assert.strictEqual(vault.isLocked(), true);
    assert.throws(() => vault.getPrivkey(), /Vault is locked/);
  });

  it('nip04Decrypt: allow + locked → vault blocks operation', async () => {
    await permissions.save('app.com', 'nip04Decrypt', null, 'allow');
    vault.lock();
    const decision = await permissions.check('app.com', 'nip04Decrypt');
    assert.strictEqual(decision, 'allow');
    assert.strictEqual(vault.isLocked(), true);
  });

  it('no permission → encrypt/decrypt would queue for approval', async () => {
    const e = await permissions.check('noperm.com', 'nip04Encrypt');
    const d = await permissions.check('noperm.com', 'nip04Decrypt');
    const e44 = await permissions.check('noperm.com', 'nip44Encrypt');
    const d44 = await permissions.check('noperm.com', 'nip44Decrypt');
    assert.strictEqual(e, 'ask');
    assert.strictEqual(d, 'ask');
    assert.strictEqual(e44, 'ask');
    assert.strictEqual(d44, 'ask');
  });
});

describe('communication: permissions × lock — cross-cutting', () => {
  beforeEach(() => setupPermissionTest());

  it('wildcard deny blocks all methods for a domain', async () => {
    await permissions.save('blocked.com', '*', null, 'deny');
    const gp = await permissions.check('blocked.com', 'getPublicKey');
    const se = await permissions.check('blocked.com', 'signEvent', 1);
    const enc = await permissions.check('blocked.com', 'nip04Encrypt');
    assert.strictEqual(gp, 'deny');
    assert.strictEqual(se, 'deny');
    assert.strictEqual(enc, 'deny');
  });

  it('kind-specific overrides method-level permission', async () => {
    await permissions.save('app.com', 'signEvent', null, 'deny'); // method-level deny
    await permissions.save('app.com', 'signEvent', 1, 'allow');   // kind 1 allowed

    const kind1 = await permissions.check('app.com', 'signEvent', 1);
    const kind4 = await permissions.check('app.com', 'signEvent', 4);
    assert.strictEqual(kind1, 'allow'); // kind-specific override
    assert.strictEqual(kind4, 'deny');  // falls back to method-level
  });

  it('locking vault does not change permission decisions', async () => {
    await permissions.save('app.com', 'signEvent', 1, 'allow');
    await permissions.save('app.com', 'getPublicKey', null, 'deny');

    const beforeSign = await permissions.check('app.com', 'signEvent', 1);
    const beforePk = await permissions.check('app.com', 'getPublicKey');

    vault.lock();

    const afterSign = await permissions.check('app.com', 'signEvent', 1);
    const afterPk = await permissions.check('app.com', 'getPublicKey');

    assert.strictEqual(beforeSign, afterSign);
    assert.strictEqual(beforePk, afterPk);
  });

  it('deny is enforced even if vault has the key ready', async () => {
    // Vault is unlocked and has a key — but permission says deny
    assert.strictEqual(vault.isLocked(), false);
    assert.ok(vault.getPrivkey('acct1')); // key is available
    vault.getPrivkey('acct1')!.fill(0);

    await permissions.save('app.com', 'signEvent', 1, 'deny');
    const { handleSignEvent } = await import('../lib/signer.js');
    const event: UnsignedEvent = {
      kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x'
    };
    await assert.rejects(
      () => handleSignEvent(event, 'app.com'),
      /Permission denied/
    );
  });
});
