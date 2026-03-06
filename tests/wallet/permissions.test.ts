import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from '../helpers/browser-mock.ts';
import * as permissions from '../../lib/permissions.ts';

describe('wallet permissions', () => {
  beforeEach(() => {
    resetMockStorage();
  });

  it('webln_sendPayment defaults to ask', async () => {
    const result = await permissions.check('primal.net', 'webln_sendPayment');
    assert.equal(result, 'ask');
  });

  it('saves and checks webln_sendPayment permission', async () => {
    await permissions.save('primal.net', 'webln_sendPayment', null, 'allow');
    const result = await permissions.check('primal.net', 'webln_sendPayment');
    assert.equal(result, 'allow');
  });

  it('webln_getBalance defaults to ask', async () => {
    const result = await permissions.check('example.com', 'webln_getBalance');
    assert.equal(result, 'ask');
  });

  it('webln permissions are domain-isolated', async () => {
    await permissions.save('primal.net', 'webln_sendPayment', null, 'allow');
    const result = await permissions.check('coracle.social', 'webln_sendPayment');
    assert.equal(result, 'ask');
  });

  it('webln deny is respected', async () => {
    await permissions.save('evil.com', 'webln_sendPayment', null, 'deny');
    const result = await permissions.check('evil.com', 'webln_sendPayment');
    assert.equal(result, 'deny');
  });

  it('webln wildcard works', async () => {
    await permissions.save('trusted.com', '*', null, 'allow');
    const result = await permissions.check('trusted.com', 'webln_sendPayment');
    assert.equal(result, 'allow');
  });

  it('permissionKey passes webln_ methods through as-is', () => {
    assert.equal(permissions.permissionKey('webln_sendPayment'), 'webln_sendPayment');
    assert.equal(permissions.permissionKey('webln_getBalance'), 'webln_getBalance');
    assert.equal(permissions.permissionKey('webln_makeInvoice'), 'webln_makeInvoice');
    assert.equal(permissions.permissionKey('webln_getInfo'), 'webln_getInfo');
  });
});
