import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from '../helpers/browser-mock.ts';
import * as signer from '../../lib/signer.ts';
import * as vault from '../../lib/vault.ts';

/** Wait for queueRequest to flush its storage write */
const tick = () => new Promise<void>(r => setTimeout(r, 100));

describe('wallet payment approval', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('queues a payment request with walletAmount and needsPermission', async () => {
    const promise = signer.queueRequest({
      type: 'webln_sendPayment',
      origin: 'primal.net',
      needsPermission: true,
      walletAmount: 1000,
    });

    await tick();

    const pending = await signer.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].type, 'webln_sendPayment');
    assert.equal(pending[0].walletAmount, 1000);
    assert.equal(pending[0].origin, 'primal.net');
    assert.equal(pending[0].needsPermission, true);

    // Resolve it
    signer.resolveRequest(pending[0].id, { allow: true });
    const result = await promise;
    assert.ok(result.allow);
  });

  it('rejected payment returns deny', async () => {
    const promise = signer.queueRequest({
      type: 'webln_sendPayment',
      origin: 'evil.com',
      walletAmount: 100000,
    });

    await tick();

    const pending = await signer.getPending();
    signer.resolveRequest(pending[0].id, { allow: false });
    const result = await promise;
    assert.equal(result.allow, false);
  });

  it('payment request without walletAmount works', async () => {
    const promise = signer.queueRequest({
      type: 'webln_makeInvoice',
      origin: 'example.com',
    });

    await tick();

    const pending = await signer.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].walletAmount, undefined);

    signer.resolveRequest(pending[0].id, { allow: true });
    await promise;
  });

  it('walletAmount is preserved in pending storage', async () => {
    const promise = signer.queueRequest({
      type: 'webln_sendPayment',
      origin: 'test.com',
      walletAmount: 5000,
    });

    await tick();

    // Read directly from getPending
    const pending = await signer.getPending();
    assert.equal(pending[0].walletAmount, 5000);

    // Clean up: resolve the request to avoid hanging
    signer.resolveRequest(pending[0].id, { allow: true });
    await promise;
  });
});
