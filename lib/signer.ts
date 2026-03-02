/**
 * NIP-07 Signer -- Request Coordinator with In-Popup Approval
 *
 * Handles all NIP-07 signing requests from web pages, coordinating between
 * the vault (key storage), permissions (allow/deny policies), and the
 * popup approval overlay (user authorization).
 *
 * Signing flow:
 *   1. Web page calls window.nostr.signEvent(event)
 *   2. inject.js posts NIP07_REQUEST to content script
 *   3. content.js forwards to background.js with origin
 *   4. background.js routes to signer.js
 *   5. signer checks permissions (even if locked)
 *   6. if permission is 'ask', queues request for popup approval (badge shown)
 *   7. if permission is 'allow' but vault locked, queues as waitingForUnlock
 *   8. user opens popup, sees pending requests, approves/denies
 *   9. vault.getPrivkey() -> sign -> zero key bytes -> return signed event
 *
 * Permissions are account-type-agnostic (allow/deny/ask). After permission
 * is granted, routing is based on account type: NIP-46 forwards to remote
 * signer, local accounts sign with the vault.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md
 * @module lib/signer
 */

import type { RequestDecision, PendingRequest, UnsignedEvent, SignedEvent, SafeAccount, AccountType } from './types.ts';
import browser from './browser.ts';
import * as vault from './vault.ts';
import * as permissions from './permissions.ts';
import { signEvent as cryptoSignEvent } from './crypto/nip01.js';
import { bytesToHex, hexToBytes } from './crypto/utils.js';
import { getPublicKey } from './crypto/secp256k1.js';
import { Nip46Client } from './nip46.ts';
import { nip04Encrypt, nip04Decrypt } from './crypto/nip04.js';
import { nip44Encrypt, nip44Decrypt } from './crypto/nip44.js';

// In-memory resolvers for pending requests (keyed by request ID)
const _pendingResolvers: Map<string, (decision: RequestDecision) => void> = new Map();
let _requestCounter: number = 0;

// Timeout for pending requests (2 minutes)
const REQUEST_TIMEOUT_MS = 120_000;
const _timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Mutex for session storage writes (prevents concurrent read-modify-write races)
let _storageLock: Promise<void> = Promise.resolve();
async function withStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = _storageLock;
  let release!: () => void;
  _storageLock = new Promise(r => release = r);
  await prev;
  try { return await fn(); } finally { release(); }
}

// NIP-46 client instances (keyed by account ID)
const _nip46Clients: Map<string, Nip46Client> = new Map();

/**
 * Get info about the currently active account for permission checks.
 *
 * storage.local.activeAccountId is the SINGLE SOURCE OF TRUTH for which account
 * is active.  The vault's internal activeAccountId can diverge after service-worker
 * restarts + auto-unlock, so we never trust it here.
 */
async function getActiveAccountInfo(): Promise<{ accountId: string | null; accountType: AccountType | null }> {
  const data = await browser.storage.local.get(['accounts', 'activeAccountId']);
  const accountId: string | null = data.activeAccountId as string | null;

  if (!accountId) {
    return { accountId: null, accountType: null };
  }

  // Look up account type from the accounts list (covers all account types)
  const storageAcct = ((data.accounts || []) as Array<{ id: string; type?: string }>).find((a: { id: string; type?: string }) => a.id === accountId);
  if (storageAcct) {
    return { accountId, accountType: (storageAcct.type || 'generated') as AccountType };
  }

  // Account ID set but not found in accounts array -- shouldn't happen
  return { accountId, accountType: null };
}

/**
 * Get the active account's public key
 * @returns hex pubkey
 */
export async function getActivePublicKey(): Promise<string | null> {
  // storage.sync.myPubkey is the canonical source -- always updated by switchAccount/loadConfig
  const data = await browser.storage.sync.get('myPubkey');
  if (data.myPubkey) return data.myPubkey as string;

  // Fallback to vault (e.g., during initial setup before sync storage is set)
  return vault.getActivePubkey();
}

/**
 * Handle getPublicKey request with permission check
 */
export async function handleGetPublicKey(origin: string): Promise<string | null> {
  const { accountId } = await getActiveAccountInfo();
  const decision = await permissions.check(origin, 'getPublicKey', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'getPublicKey',
      origin,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('getPublicKey'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied access');
  }

  // getPublicKey is always local (we know the pubkey for all account types)
  return getActivePublicKey();
}

// -- Pending Request Queue --

interface QueueRequestInput {
  type: string;
  origin: string;
  pubkey?: string;
  event?: Partial<UnsignedEvent>;
  theirPubkey?: string;
  permKey?: string | null;
  eventKind?: number;
  needsPermission?: boolean;
  waitingForUnlock?: boolean;
  nip46InFlight?: boolean;
  accountId?: string | null;
}

async function queueRequest(request: QueueRequestInput): Promise<RequestDecision> {
  const id = `req_${crypto.randomUUID()}`;
  const entry: PendingRequest = { id, ...request, timestamp: Date.now() };

  // Serialized storage write to prevent concurrent read-modify-write races
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    pending.push(entry);
    await browser.storage.session.set({ signerPending: pending });
    // Don't update badge for NIP-46 in-flight (no user action needed)
    if (!request.nip46InFlight) {
      await updateBadge(pending.filter(r => !r.nip46InFlight).length);
    }
  });

  // Notify popup (fire-and-forget, popup may not be open)
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});

  // Auto-open the popup only if the request needs user action and is from the active tab
  if (!request.nip46InFlight) {
    try {
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.url) {
        const activeDomain = new URL(activeTab.url).hostname;
        if (request.origin === activeDomain) {
          await browser.action.openPopup();
        }
      }
    } catch {}
  }

  // Return promise that resolves when popup decides (not used for nip46InFlight)
  return new Promise((resolve, reject) => {
    _pendingResolvers.set(id, resolve);

    const timer = setTimeout(() => {
      _pendingResolvers.delete(id);
      _timeoutTimers.delete(id);
      removePendingFromStorage(id);
      reject(new Error('Request timed out'));
    }, REQUEST_TIMEOUT_MS);
    _timeoutTimers.set(id, timer);
  });
}

/**
 * Queue a NIP-46 in-flight tracking entry (no badge, no popup).
 * @returns the entry ID
 */
async function queueNip46InFlight(request: QueueRequestInput): Promise<string> {
  const id = `nip46_${Date.now()}_${++_requestCounter}`;
  const entry: PendingRequest = { id, ...request, nip46InFlight: true, timestamp: Date.now() };

  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    pending.push(entry);
    await browser.storage.session.set({ signerPending: pending });
    // No badge update for in-flight entries
  });

  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
  return id;
}

/**
 * Remove a NIP-46 in-flight tracking entry.
 */
async function removeNip46InFlight(id: string): Promise<void> {
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || []).filter((r: PendingRequest) => r.id !== id);
    await browser.storage.session.set({ signerPending: pending });
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

async function updateBadge(count: number): Promise<void> {
  try {
    const text = count > 0 ? String(count) : '';
    await browser.action.setBadgeText({ text });
    if (count > 0) {
      await browser.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    }
  } catch (e) {
    console.warn('[SIGNER] updateBadge failed:', (e as Error).message);
  }
}

async function removePendingFromStorage(id: string): Promise<void> {
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || []).filter((r: PendingRequest) => r.id !== id);
    await browser.storage.session.set({ signerPending: pending });
    await updateBadge(pending.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Resolve a single pending request by ID
 * @param id - request ID
 * @param decision - { allow: boolean, remember: boolean, rememberKind?: boolean }
 */
export function resolveRequest(id: string, decision: RequestDecision): void {
  const resolver = _pendingResolvers.get(id);
  if (resolver) {
    resolver(decision);
    _pendingResolvers.delete(id);
  }
  const timer = _timeoutTimers.get(id);
  if (timer) { clearTimeout(timer); _timeoutTimers.delete(id); }
  removePendingFromStorage(id);
}

/**
 * Resolve all pending requests matching origin + method
 * @param origin - requesting domain
 * @param method - request type (e.g. 'nip44Decrypt')
 * @param decision - { allow: boolean, remember: boolean }
 */
export async function resolveBatch(origin: string, method: string, decision: RequestDecision, eventKind?: number): Promise<void> {
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const kindMatch = (r: PendingRequest) => eventKind === undefined || r.eventKind === eventKind;
    const matching = pending.filter(r => r.origin === origin && r.type === method && kindMatch(r));
    for (const req of matching) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver(decision);
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    // Remove all matching from storage at once
    const remaining = pending.filter(r => !(r.origin === origin && r.type === method && kindMatch(r)));
    await browser.storage.session.set({ signerPending: remaining });
    await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Get all pending requests from session storage
 */
export async function getPending(): Promise<PendingRequest[]> {
  const data = await browser.storage.session.get('signerPending');
  return (data.signerPending as PendingRequest[] | undefined) || [];
}

/**
 * Called after vault is successfully unlocked.
 * Resolves all pending requests that were waiting for unlock only.
 */
export async function onVaultUnlocked(): Promise<void> {
  let hadWaiters = false;
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const unlockWaiters = pending.filter(r => r.waitingForUnlock);
    for (const req of unlockWaiters) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver({ allow: true, remember: false });
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    if (unlockWaiters.length > 0) {
      hadWaiters = true;
      const remaining = pending.filter(r => !r.waitingForUnlock);
      await browser.storage.session.set({ signerPending: remaining });
      await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
    }
  });
  if (hadWaiters) {
    browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
  }
}

/**
 * Clean up stale pending requests on service worker startup.
 * Resolvers are lost on restart, so clear session storage.
 */
export async function cleanupStale(): Promise<void> {
  for (const timer of _timeoutTimers.values()) clearTimeout(timer);
  _timeoutTimers.clear();
  _pendingResolvers.clear();
  await withStorageLock(async () => {
    await browser.storage.session.set({ signerPending: [] });
    await updateBadge(0);
  });
}

/**
 * Reject all pending requests for a specific account.
 * Called when switching accounts to prevent signing with the wrong key.
 * @param accountId
 */
export async function rejectPendingForAccount(accountId: string): Promise<void> {
  if (!accountId) return;
  await withStorageLock(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const forAccount = pending.filter(r => r.accountId === accountId);
    for (const req of forAccount) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver({ allow: false, reason: 'Account switched' });
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    const remaining = pending.filter(r => r.accountId !== accountId);
    await browser.storage.session.set({ signerPending: remaining });
    await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

// -- NIP-07 Request Handlers --

/**
 * Handle signEvent request
 */
export async function handleSignEvent(event: UnsignedEvent, origin: string): Promise<SignedEvent> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  const decision = await permissions.check(origin, 'signEvent', event.kind, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'signEvent',
      origin,
      event: (() => {
        const e: Partial<UnsignedEvent> = { kind: event.kind, content: event.content?.slice(0, 200) };
        if (event.kind === 3 && event.tags) e.tags = event.tags;
        return e;
      })(),
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('signEvent', event.kind),
      eventKind: event.kind,
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied signing');

    // Save permission and batch-resolve remaining requests if user chose "remember"
    if (approved.remember) {
      const kind = approved.rememberKind !== false ? event.kind : null;
      await permissions.save(origin, 'signEvent', kind ?? null, 'allow', accountId ?? undefined);
      // Only batch-resolve requests with the same event kind
      await resolveBatch(origin, 'signEvent', { allow: true, remember: false }, event.kind);
    }
  }

  // Route by account type
  if (accountType === 'nip46') {
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'signEvent', origin, accountId });
    try {
      return await handleNip46Request(acct, 'signEvent', event, origin);
    } finally {
      await removeNip46InFlight(nip46ReqId);
    }
  }

  // Local signing -- wait for vault unlock if needed
  if (vault.isLocked()) {
    const pubkey = await getActivePublicKey();
    await queueRequest({
      type: 'signEvent',
      origin,
      pubkey: pubkey ?? undefined,
      waitingForUnlock: true,
      needsPermission: false,
      accountId,
    });
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');

  try {
    return await cryptoSignEvent(event, privkey);
  } finally {
    privkey.fill(0);
  }
}

/**
 * Handle NIP-04 encrypt request
 */
export async function handleNip04Encrypt(theirPubkey: string, plaintext: string, origin: string): Promise<string> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  const decision = await permissions.check(origin, 'nip04Encrypt', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'nip04Encrypt',
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('nip04Encrypt'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied encryption');
  }

  if (accountType === 'nip46') {
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'nip04Encrypt', origin, accountId });
    try {
      return await handleNip46Request(acct, 'nip04Encrypt', { pubkey: theirPubkey, plaintext }, origin);
    } finally {
      await removeNip46InFlight(nip46ReqId);
    }
  }

  if (vault.isLocked()) {
    const pubkey = await getActivePublicKey();
    await queueRequest({
      type: 'nip04Encrypt',
      origin,
      pubkey: pubkey ?? undefined,
      waitingForUnlock: true,
      needsPermission: false,
      accountId,
    });
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');
  try {
    return await nip04Encrypt(plaintext, privkey, hexToBytes(theirPubkey));
  } finally {
    privkey.fill(0);
  }
}

/**
 * Handle NIP-04 decrypt request
 */
export async function handleNip04Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  const decision = await permissions.check(origin, 'nip04Decrypt', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'nip04Decrypt',
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('nip04Decrypt'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied decryption');
  }

  if (accountType === 'nip46') {
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'nip04Decrypt', origin, accountId });
    try {
      return await handleNip46Request(acct, 'nip04Decrypt', { pubkey: theirPubkey, ciphertext }, origin);
    } finally {
      await removeNip46InFlight(nip46ReqId);
    }
  }

  if (vault.isLocked()) {
    const pubkey = await getActivePublicKey();
    await queueRequest({
      type: 'nip04Decrypt',
      origin,
      pubkey: pubkey ?? undefined,
      waitingForUnlock: true,
      needsPermission: false,
      accountId,
    });
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');
  try {
    return await nip04Decrypt(ciphertext, privkey, hexToBytes(theirPubkey));
  } finally {
    privkey.fill(0);
  }
}

/**
 * Handle NIP-44 encrypt request
 */
export async function handleNip44Encrypt(theirPubkey: string, plaintext: string, origin: string): Promise<string> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  const decision = await permissions.check(origin, 'nip44Encrypt', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'nip44Encrypt',
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('nip44Encrypt'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied encryption');
  }

  if (accountType === 'nip46') {
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'nip44Encrypt', origin, accountId });
    try {
      return await handleNip46Request(acct, 'nip44Encrypt', { pubkey: theirPubkey, plaintext }, origin);
    } finally {
      await removeNip46InFlight(nip46ReqId);
    }
  }

  if (vault.isLocked()) {
    const pubkey = await getActivePublicKey();
    await queueRequest({
      type: 'nip44Encrypt',
      origin,
      pubkey: pubkey ?? undefined,
      waitingForUnlock: true,
      needsPermission: false,
      accountId,
    });
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');
  try {
    return await nip44Encrypt(plaintext, privkey, hexToBytes(theirPubkey));
  } finally {
    privkey.fill(0);
  }
}

/**
 * Handle NIP-44 decrypt request
 */
export async function handleNip44Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  const decision = await permissions.check(origin, 'nip44Decrypt', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'nip44Decrypt',
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('nip44Decrypt'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied decryption');
  }

  if (accountType === 'nip46') {
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'nip44Decrypt', origin, accountId });
    try {
      return await handleNip46Request(acct, 'nip44Decrypt', { pubkey: theirPubkey, ciphertext }, origin);
    } finally {
      await removeNip46InFlight(nip46ReqId);
    }
  }

  if (vault.isLocked()) {
    const pubkey = await getActivePublicKey();
    await queueRequest({
      type: 'nip44Decrypt',
      origin,
      pubkey: pubkey ?? undefined,
      waitingForUnlock: true,
      needsPermission: false,
      accountId,
    });
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');
  try {
    return await nip44Decrypt(ciphertext, privkey, hexToBytes(theirPubkey));
  } finally {
    privkey.fill(0);
  }
}

// -- NIP-46 Remote Signer --

async function getNip46Client(acct: SafeAccount): Promise<Nip46Client> {
  if (_nip46Clients.has(acct.id)) {
    const client = _nip46Clients.get(acct.id)!;
    if (client.connected) return client;
    try { client.close(); } catch {}
    _nip46Clients.delete(acct.id);
  }

  if (!acct.nip46Config) throw new Error('No NIP-46 config');

  const config = Nip46Client.parseUrl(acct.nip46Config.bunkerUrl);
  const client = new Nip46Client(config);

  // Restore persisted ephemeral keypair so the signer recognizes this client
  if (acct.nip46Config.localPrivkey) {
    client.localPrivkey = hexToBytes(acct.nip46Config.localPrivkey);
    client.localPubkey = acct.nip46Config.localPubkey ?? null;
  }

  await client.connect();
  _nip46Clients.set(acct.id, client);
  return client;
}

async function handleNip46Request(acct: SafeAccount, method: string, data: unknown, origin: string): Promise<any> {
  const client = await getNip46Client(acct);

  switch (method) {
    case 'signEvent':
      return client.signEventRemote(data as Partial<UnsignedEvent>);
    case 'nip04Encrypt':
      return client.nip04EncryptRemote((data as { pubkey: string; plaintext: string }).pubkey, (data as { pubkey: string; plaintext: string }).plaintext);
    case 'nip04Decrypt':
      return client.nip04DecryptRemote((data as { pubkey: string; ciphertext: string }).pubkey, (data as { pubkey: string; ciphertext: string }).ciphertext);
    case 'nip44Encrypt':
      return client.nip44EncryptRemote((data as { pubkey: string; plaintext: string }).pubkey, (data as { pubkey: string; plaintext: string }).plaintext);
    case 'nip44Decrypt':
      return client.nip44DecryptRemote((data as { pubkey: string; ciphertext: string }).pubkey, (data as { pubkey: string; ciphertext: string }).ciphertext);
    default:
      throw new Error(`Unsupported NIP-46 method: ${method}`);
  }
}

/**
 * Check if a NIP-46 client is currently connected
 */
export function isNip46Connected(accountId: string): boolean {
    const client = _nip46Clients.get(accountId);
    return client?.connected === true;
}

/**
 * Disconnect and remove a NIP-46 client
 */
export function disconnectNip46(accountId: string): void {
    const client = _nip46Clients.get(accountId);
    if (client) {
        client.close();
        _nip46Clients.delete(accountId);
    }
}
