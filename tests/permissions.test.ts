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
    assert.strictEqual(perms['nip04Encrypt'], 'deny');
  });

  it('getForDomain returns empty for unknown domain', async () => {
    const perms: any = await permissions.getForDomain('unknown.com');
    assert.deepStrictEqual(perms, {});
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
