import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as permissions from '../lib/permissions.js';

describe('permissions -- check cascade', () => {
  beforeEach(() => resetMockStorage());

  it('returns "ask" when no permissions exist', async () => {
    const result: string = await permissions.check('example.com', 'signEvent', 1);
    assert.strictEqual(result, 'ask');
  });

  it('returns kind-specific permission (most specific)', async () => {
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    await permissions.save('example.com', 'signEvent', null, 'deny');
    // Kind 1 should be allow (more specific)
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');
    // Kind 0 should fall through to method-level deny
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 0), 'deny');
  });

  it('returns method-level when no kind match', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 999), 'allow');
  });

  it('returns domain wildcard when no method match', async () => {
    await permissions.save('example.com', '*', null, 'deny');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt'), 'deny');
  });

  it('cascade order: kind > method > wildcard > ask', async () => {
    // Set wildcard allow
    await permissions.save('example.com', '*', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');

    // Set method-level deny (overrides wildcard)
    await permissions.save('example.com', 'signEvent', null, 'deny');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'deny');

    // Set kind-level allow (overrides method)
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');
    // Kind 0 still denied at method level
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 0), 'deny');
  });
});

describe('permissions -- isolation', () => {
  beforeEach(() => resetMockStorage());

  it('different domains are isolated', async () => {
    await permissions.save('site-a.com', 'signEvent', null, 'allow');
    await permissions.save('site-b.com', 'signEvent', null, 'deny');
    assert.strictEqual(await permissions.check('site-a.com', 'signEvent'), 'allow');
    assert.strictEqual(await permissions.check('site-b.com', 'signEvent'), 'deny');
    assert.strictEqual(await permissions.check('site-c.com', 'signEvent'), 'ask');
  });

  it('different methods are isolated', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt'), 'ask');
  });
});

describe('permissions -- save and clear', () => {
  beforeEach(() => resetMockStorage());

  it('save and retrieve', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    const all: any = await permissions.getAll();
    assert.ok(all['example.com']);
    assert.strictEqual(all['example.com']['signEvent'], 'allow');
  });

  it('clear specific domain', async () => {
    await permissions.save('a.com', 'signEvent', null, 'allow');
    await permissions.save('b.com', 'signEvent', null, 'allow');
    await permissions.clear('a.com');
    assert.strictEqual(await permissions.check('a.com', 'signEvent'), 'ask');
    assert.strictEqual(await permissions.check('b.com', 'signEvent'), 'allow');
  });

  it('clear all permissions', async () => {
    await permissions.save('a.com', 'signEvent', null, 'allow');
    await permissions.save('b.com', 'signEvent', null, 'allow');
    await permissions.clear();
    assert.strictEqual(await permissions.check('a.com', 'signEvent'), 'ask');
    assert.strictEqual(await permissions.check('b.com', 'signEvent'), 'ask');
  });

  it('getForDomain returns domain permissions', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    await permissions.save('example.com', 'nip04Encrypt', null, 'deny');
    const perms: any = await permissions.getForDomain('example.com');
    assert.strictEqual(perms['signEvent'], 'allow');
    // nip04Encrypt maps to logical key 'sendMessages'
    assert.strictEqual(perms['sendMessages'], 'deny');
  });

  it('getForDomain returns empty for unknown domain', async () => {
    const perms: any = await permissions.getForDomain('unknown.com');
    assert.deepStrictEqual(perms, {});
  });
});

describe('permissions -- per-account clear isolation', () => {
  beforeEach(() => resetMockStorage());

  it('clear in global-defaults mode only removes _default bucket', async () => {
    // Global defaults mode is the default (signerUseGlobalDefaults defaults to true)
    // Save permissions for _default bucket (global mode)
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
    await permissions.save('example.com', 'signEvent', 1, 'allow');

    // Switch to per-account mode and save permissions for acct1
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');
    await permissions.save('example.com', 'nip04Encrypt', null, 'deny', 'acct1');

    // Switch back to global mode and clear for this domain
    await permissions.setUseGlobalDefaults(true);
    await permissions.clear('example.com');

    // Global defaults should be gone
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey'), 'ask');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'ask');

    // Per-account permissions for acct1 should still exist
    await permissions.setUseGlobalDefaults(false);
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct1'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt', undefined, 'acct1'), 'deny');
  });

  it('clear in per-account mode only removes that account bucket', async () => {
    await permissions.setUseGlobalDefaults(false);

    // Save permissions for two different accounts
    await permissions.save('example.com', 'getPublicKey', null, 'allow', 'acct1');
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');
    await permissions.save('example.com', 'getPublicKey', null, 'allow', 'acct2');
    await permissions.save('example.com', 'signEvent', 1, 'deny', 'acct2');

    // Clear acct1's permissions
    await permissions.clear('example.com', 'acct1');

    // acct1 should be cleared
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey', undefined, 'acct1'), 'ask');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct1'), 'ask');

    // acct2 should be untouched
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey', undefined, 'acct2'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct2'), 'deny');
  });

  it('clear preserves _default when clearing per-account bucket', async () => {
    // Save global defaults
    await permissions.save('example.com', 'getPublicKey', null, 'allow');

    // Save per-account permissions
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');

    // Clear acct1
    await permissions.clear('example.com', 'acct1');

    // _default should be preserved
    await permissions.setUseGlobalDefaults(true);
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey'), 'allow');
  });

  it('domain entry removed only when all buckets are empty', async () => {
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');

    // Clear the only bucket — domain entry should be removed
    await permissions.clear('example.com', 'acct1');
    const raw = await permissions.getAllRaw();
    assert.strictEqual(raw['example.com'], undefined);
  });

  it('clear does nothing for nonexistent domain', async () => {
    // Should not throw
    await permissions.clear('nonexistent.com', 'acct1');
    const raw = await permissions.getAllRaw();
    assert.strictEqual(raw['nonexistent.com'], undefined);
  });
});

describe('permissions -- NIP-07 methods', () => {
  beforeEach(() => resetMockStorage());

  const methods: string[] = ['signEvent', 'nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt'];

  for (const method of methods) {
    it(`${method}: allow and deny work`, async () => {
      await permissions.save('test.com', method, null, 'allow');
      assert.strictEqual(await permissions.check('test.com', method), 'allow');

      await permissions.save('test.com', method, null, 'deny');
      assert.strictEqual(await permissions.check('test.com', method), 'deny');
    });
  }
});

describe('permissions -- encrypt/decrypt key mapping', () => {
  beforeEach(() => resetMockStorage());

  it('nip04 and nip44 encrypt share sendMessages key', async () => {
    await permissions.save('test.com', 'nip04Encrypt', null, 'allow');
    // nip44Encrypt should also be allowed (same logical key)
    assert.strictEqual(await permissions.check('test.com', 'nip44Encrypt'), 'allow');
  });

  it('nip04 and nip44 decrypt share readMessages key', async () => {
    await permissions.save('test.com', 'nip04Decrypt', null, 'allow');
    // nip44Decrypt should also be allowed (same logical key)
    assert.strictEqual(await permissions.check('test.com', 'nip44Decrypt'), 'allow');
  });

  it('permissionKey maps encrypt methods to sendMessages', () => {
    assert.strictEqual(permissions.permissionKey('nip04Encrypt'), 'sendMessages');
    assert.strictEqual(permissions.permissionKey('nip44Encrypt'), 'sendMessages');
  });

  it('permissionKey maps decrypt methods to readMessages', () => {
    assert.strictEqual(permissions.permissionKey('nip04Decrypt'), 'readMessages');
    assert.strictEqual(permissions.permissionKey('nip44Decrypt'), 'readMessages');
  });

  it('encrypt/decrypt permissions survive migrateToPerKind', async () => {
    await permissions.save('test.com', 'nip04Decrypt', null, 'allow');
    await permissions.save('test.com', 'nip44Encrypt', null, 'deny');

    // Migration should NOT delete readMessages/sendMessages keys
    await permissions.migrateToPerKind();

    assert.strictEqual(await permissions.check('test.com', 'nip04Decrypt'), 'allow');
    assert.strictEqual(await permissions.check('test.com', 'nip44Encrypt'), 'deny');
  });
});
