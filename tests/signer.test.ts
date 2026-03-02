import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browserMock from './helpers/browser-mock.ts';
import * as vault from '../lib/vault.js';
import * as permissions from '../lib/permissions.js';
import * as signer from '../lib/signer.js';
import type { VaultPayload } from '../lib/types.ts';

const TEST_PASSWORD = 'testpassword123';
const TEST_PRIVKEY_HEX = 'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const TEST_PUBKEY_HEX = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
// A second pubkey to act as "their" pubkey for encrypt/decrypt
const THEIR_PUBKEY_HEX = 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';

function makePayload(): VaultPayload {
  return {
    accounts: [{
      id: 'acct1',
      name: 'Test',
      type: 'nsec',
      pubkey: TEST_PUBKEY_HEX,
      privkey: TEST_PRIVKEY_HEX,
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: 1000000
    }],
    activeAccountId: 'acct1'
  };
}

async function setupVault(): Promise<void> {
  await vault.create(TEST_PASSWORD, makePayload());
  // Vault is now unlocked
}

// -- Pending Queue Tests --

describe('signer -- pending request queue', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('queueRequest stores entry in session storage', async () => {
    // Set permission to 'ask' (default, no permission saved)
    // Simulate what handleSignEvent does when permission is 'ask'
    await setupVault();

    // Start a signEvent that will queue (permission is 'ask')
    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    // Give the queue time to write to storage
    await new Promise<void>(r => setTimeout(r, 50));

    // Check that pending request exists in storage
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'Should have 1 pending request');
    assert.strictEqual(pending[0].type, 'signEvent');
    assert.strictEqual(pending[0].origin, 'test.com');
    assert.strictEqual(pending[0].needsPermission, true);

    // Resolve it (deny to clean up)
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });

    // signPromise should reject with 'User denied'
    await assert.rejects(signPromise, /User denied/);
  });

  it('resolveRequest removes entry from storage', async () => {
    await setupVault();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);

    signer.resolveRequest(pending[0].id, { allow: false, remember: false });
    await assert.rejects(signPromise, /User denied/);

    // Give storage time to update
    await new Promise<void>(r => setTimeout(r, 50));

    const afterResolve: any[] = await signer.getPending();
    assert.strictEqual(afterResolve.length, 0, 'Should have 0 pending after resolve');
  });

  it('concurrent queueRequest calls do not lose entries (mutex test)', async () => {
    await setupVault();

    // Fire 10 concurrent signEvent requests
    const N = 10;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        signer.handleSignEvent(
          { kind: 1, content: `msg ${i}`, tags: [], created_at: Math.floor(Date.now() / 1000) },
          'test.com'
        )
      );
    }

    // Wait for all to be queued (mutex serializes writes)
    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, N, `Should have ${N} pending requests, got ${pending.length}`);

    // Clean up: deny all
    for (const req of pending) {
      signer.resolveRequest(req.id, { allow: false, remember: false });
    }

    // All promises should reject
    for (const p of promises) {
      await assert.rejects(p, /User denied/);
    }
  });

  it('resolveBatch resolves all matching requests at once', async () => {
    await setupVault();

    // Fire 5 concurrent decrypt requests from same origin
    const N = 5;
    const promises: Promise<any>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(
        signer.handleNip44Decrypt(THEIR_PUBKEY_HEX, 'fakeciphertext', 'coracle.social')
      );
    }

    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, N);

    // Batch deny all nip44Decrypt from coracle.social
    await signer.resolveBatch('coracle.social', 'nip44Decrypt', { allow: false, remember: false });

    for (const p of promises) {
      await assert.rejects(p, /User denied/);
    }

    await new Promise<void>(r => setTimeout(r, 50));
    const afterBatch: any[] = await signer.getPending();
    assert.strictEqual(afterBatch.length, 0, 'Batch resolve should clear all matching');
  });

  it('cleanupStale clears all pending requests', async () => {
    await setupVault();

    signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));
    assert.strictEqual((await signer.getPending()).length, 1);

    await signer.cleanupStale();
    assert.strictEqual((await signer.getPending()).length, 0);
  });
});

// -- Approval Flow Tests --

describe('signer -- signEvent approval flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('auto-allows when permission is "allow" and vault unlocked', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signed: any = await signer.handleSignEvent(event, 'test.com');

    assert.ok(signed, 'Should return signed event');
    assert.ok(signed.id, 'Signed event should have id');
    assert.ok(signed.sig, 'Signed event should have sig');
    assert.strictEqual(signed.pubkey, TEST_PUBKEY_HEX);
  });

  it('denies when permission is "deny"', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'deny');

    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /Permission denied/
    );
  });

  it('queues for approval when permission is "ask", signs on approve', async () => {
    await setupVault();
    // No permission saved -- defaults to 'ask'

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);

    // Approve
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should have signature after approval');
    assert.strictEqual(signed.pubkey, TEST_PUBKEY_HEX);
  });

  it('queues for approval when "ask", then denies on deny', async () => {
    await setupVault();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    signer.resolveRequest(pending[0].id, { allow: false, remember: false });

    await assert.rejects(signPromise, /User denied/);
  });

  it('saves permission and batch-resolves on "remember" approve', async () => {
    await setupVault();

    // Queue 3 signEvent requests
    const promises: Promise<any>[] = [];
    for (let i = 0; i < 3; i++) {
      promises.push(signer.handleSignEvent(
        { kind: 1, content: `msg ${i}`, tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ));
    }

    await new Promise<void>(r => setTimeout(r, 300));
    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 3);

    // Approve the first one with "remember"
    signer.resolveRequest(pending[0].id, { allow: true, remember: true, rememberKind: false });

    // All 3 should resolve (first one resolves, saves permission, batch-resolves rest)
    const results: any[] = await Promise.all(promises);
    for (const r of results) {
      assert.ok(r.sig, 'All should be signed');
    }

    // Permission should now be saved
    const perm: string = await permissions.check('test.com', 'signEvent');
    assert.strictEqual(perm, 'allow');
  });

  it('waits for vault unlock when permission is "allow" but vault locked', async () => {
    await setupVault();
    await permissions.save('test.com', 'signEvent', null, 'allow');
    vault.lock(); // Lock the vault

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].waitingForUnlock, true);

    // Unlock vault
    await vault.unlock(TEST_PASSWORD);
    // Notify signer that vault is unlocked
    await signer.onVaultUnlocked();

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should sign after vault unlock');
  });

  it('queues for permission AND vault unlock sequentially when both needed', async () => {
    await setupVault();
    vault.lock(); // Lock the vault, no permission saved (ask)

    const event = { kind: 1, content: 'hello', tags: [] as string[][], created_at: Math.floor(Date.now() / 1000) };
    const signPromise: Promise<any> = signer.handleSignEvent(event, 'test.com');

    await new Promise<void>(r => setTimeout(r, 50));

    // Should be queued for permission
    let pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].needsPermission, true);

    // Approve permission (vault still locked)
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    // Handler should now hit the vault.isLocked() check and queue for unlock
    await new Promise<void>(r => setTimeout(r, 50));

    pending = await signer.getPending();
    assert.strictEqual(pending.length, 1, 'Should have new pending for vault unlock');
    assert.strictEqual(pending[0].waitingForUnlock, true);

    // Unlock vault
    await vault.unlock(TEST_PASSWORD);
    await signer.onVaultUnlocked();

    const signed: any = await signPromise;
    assert.ok(signed.sig, 'Should sign after both permission + unlock');
  });
});

// -- NIP-44 Decrypt Approval Tests --

describe('signer -- nip44Decrypt approval flow', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('auto-decrypts when permission is "allow" and vault unlocked', async () => {
    await setupVault();
    await permissions.save('test.com', 'nip44Decrypt', null, 'allow');

    // First encrypt something so we have valid ciphertext
    const { nip44Encrypt } = await import('../lib/crypto/nip44.js');
    const { hexToBytes } = await import('../lib/crypto/utils.js');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.js');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPubkeyBytes: Uint8Array = getPublicKey(hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01')));
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    // Use a known keypair for encrypt/decrypt test
    const plaintext = 'hello secret';
    const ciphertext: string = await nip44Encrypt(plaintext, privkey, theirPubkeyBytes);

    const decrypted: string = await signer.handleNip44Decrypt(theirPubkeyHex, ciphertext, 'test.com');
    assert.strictEqual(decrypted, plaintext);
  });

  it('queues and resolves multiple concurrent decrypt requests', async () => {
    await setupVault();

    // Encrypt test messages
    const { nip44Encrypt } = await import('../lib/crypto/nip44.js');
    const { hexToBytes } = await import('../lib/crypto/utils.js');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.js');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPrivkey: Uint8Array = hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01'));
    const theirPubkeyBytes: Uint8Array = getPublicKey(theirPrivkey);
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    const messages: string[] = ['msg0', 'msg1', 'msg2', 'msg3', 'msg4'];
    const ciphertexts: string[] = [];
    for (const msg of messages) {
      ciphertexts.push(await nip44Encrypt(msg, privkey, theirPubkeyBytes));
    }

    // Fire 5 concurrent decrypt requests (no permission saved -> 'ask')
    const promises: Promise<any>[] = ciphertexts.map((ct: string) =>
      signer.handleNip44Decrypt(theirPubkeyHex, ct, 'chat.com')
    );

    // Wait for all to be queued through mutex
    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 5, `Expected 5 pending, got ${pending.length}`);

    // Batch approve all
    await signer.resolveBatch('chat.com', 'nip44Decrypt', { allow: true, remember: false });

    // All should decrypt successfully
    const results: any[] = await Promise.all(promises);
    for (let i = 0; i < messages.length; i++) {
      assert.strictEqual(results[i], messages[i], `Message ${i} should decrypt correctly`);
    }
  });

  it('batch approve with "remember" saves permission and decrypts all', async () => {
    await setupVault();

    const { nip44Encrypt } = await import('../lib/crypto/nip44.js');
    const { hexToBytes } = await import('../lib/crypto/utils.js');
    const { getPublicKey } = await import('../lib/crypto/secp256k1.js');

    const privkey: Uint8Array = hexToBytes(TEST_PRIVKEY_HEX);
    const theirPrivkey: Uint8Array = hexToBytes(THEIR_PUBKEY_HEX.replace(/a0/g, '01'));
    const theirPubkeyBytes: Uint8Array = getPublicKey(theirPrivkey);
    const theirPubkeyHex: string = Array.from(theirPubkeyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('');

    const messages: string[] = ['secret1', 'secret2', 'secret3'];
    const ciphertexts: string[] = [];
    for (const msg of messages) {
      ciphertexts.push(await nip44Encrypt(msg, privkey, theirPubkeyBytes));
    }

    const promises: Promise<any>[] = ciphertexts.map((ct: string) =>
      signer.handleNip44Decrypt(theirPubkeyHex, ct, 'chat.com')
    );

    await new Promise<void>(r => setTimeout(r, 500));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 3);

    // Save permission first (simulating what popup does)
    await permissions.save('chat.com', 'nip44Decrypt', null, 'allow');

    // Batch resolve with remember=true
    await signer.resolveBatch('chat.com', 'nip44Decrypt', { allow: true, remember: true });

    const results: any[] = await Promise.all(promises);
    for (let i = 0; i < messages.length; i++) {
      assert.strictEqual(results[i], messages[i]);
    }

    // Permission should be saved
    const perm: string = await permissions.check('chat.com', 'nip44Decrypt');
    assert.strictEqual(perm, 'allow');
  });
});

// -- Edge Cases --

describe('signer -- edge cases', () => {
  beforeEach(async () => {
    resetMockStorage();
    vault.lock();
    await signer.cleanupStale();
  });

  it('rejects account with no private key', async () => {
    const payload: VaultPayload = {
      accounts: [{
        id: 'acct1', name: 'ReadOnly', type: 'npub',
        pubkey: TEST_PUBKEY_HEX, privkey: null,
        mnemonic: null, nip46Config: null,
        readOnly: true, createdAt: 1000000
      }],
      activeAccountId: 'acct1'
    };
    await vault.create(TEST_PASSWORD, payload);
    await permissions.save('test.com', 'signEvent', null, 'allow');

    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /No private key for active account/
    );
  });

  it('rejects when no vault exists at all', async () => {
    // No vault created -- vault.exists() returns false
    await assert.rejects(
      signer.handleSignEvent(
        { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
        'test.com'
      ),
      /No signing key available/
    );
  });

  it('rejects when vault stays locked after approval', async () => {
    // This tests the guard: if vault.isLocked() throw after permission+unlock flow
    await setupVault();
    vault.lock();

    const signPromise: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'hello', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'test.com'
    );

    await new Promise<void>(r => setTimeout(r, 50));

    const pending: any[] = await signer.getPending();
    // Approve permission, but vault is still locked
    signer.resolveRequest(pending[0].id, { allow: true, remember: false });

    // Now it will queue for unlock. Deny the unlock by resolving with allow:false
    // Actually, the vault unlock waiter resolves automatically via onVaultUnlocked.
    // If we never unlock, the handler will be stuck. Let's resolve the unlock waiter
    // with deny to simulate user closing popup without unlocking.
    await new Promise<void>(r => setTimeout(r, 50));

    const pending2: any[] = await signer.getPending();
    if (pending2.length > 0) {
      // Force-resolve the waiting request (simulates clearing pending without unlock)
      signer.resolveRequest(pending2[0].id, { allow: true, remember: false });
    }

    // Vault is still locked, so should throw
    await assert.rejects(signPromise, /Vault is locked/);
  });

  it('different origins do not interfere in batch resolve', async () => {
    await setupVault();

    const p1: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'from a', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'site-a.com'
    );
    const p2: Promise<any> = signer.handleSignEvent(
      { kind: 1, content: 'from b', tags: [], created_at: Math.floor(Date.now() / 1000) },
      'site-b.com'
    );

    await new Promise<void>(r => setTimeout(r, 200));

    const pending: any[] = await signer.getPending();
    assert.strictEqual(pending.length, 2);

    // Batch resolve only site-a.com
    await signer.resolveBatch('site-a.com', 'signEvent', { allow: true, remember: false });

    // site-a should resolve
    const signedA: any = await p1;
    assert.ok(signedA.sig);

    // site-b should still be pending
    const remaining: any[] = await signer.getPending();
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].origin, 'site-b.com');

    // Clean up
    signer.resolveRequest(remaining[0].id, { allow: false, remember: false });
    await assert.rejects(p2, /User denied/);
  });
});
