/**
 * Signing Permission Policies -- Per-domain, per-account, per-kind
 *
 * Stores and checks user decisions about whether to allow signing requests
 * from specific web domains. Uses per-kind checks with account dimension:
 *   - signEvent is keyed per-kind: "signEvent:1", "signEvent:0", etc.
 *   - encrypt methods map to "sendMessages"
 *   - decrypt methods map to "readMessages"
 *   - all other methods use their name as-is
 *
 * Storage model:
 *   { "domain": { "_default": { "signEvent:1": "allow" }, "acctId": { ... } } }
 *
 * Mode-based resolution (mutually exclusive):
 *   - useGlobalDefaults=true  -> ONLY check perms[domain]["_default"][permKey]
 *   - useGlobalDefaults=false -> ONLY check perms[domain][accountId][permKey]
 *   - If not found -> return "ask"
 *
 * Dormant data is preserved on mode switch. Only the active mode's bucket
 * is consulted for reads and writes.
 *
 * The signer handler decides local vs remote routing based on accountType,
 * not the permission value.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md -- NIP-07: window.nostr capability
 *
 * @module lib/permissions
 */

import type { PermissionDecision, PermissionMap, PermissionBucket, DomainPermissions } from './types.ts';
import browser from './browser.ts';

const STORAGE_KEY = 'signerPermissions';
const GLOBAL_DEFAULTS_KEY = 'signerUseGlobalDefaults';
const DEFAULT_BUCKET = '_default';

// Decisions: "allow" | "deny" | "ask"

/**
 * Map NIP-07 wire methods to logical permission keys.
 * signEvent is per-kind, encrypt/decrypt are combined groups.
 * @param method - e.g. "signEvent", "nip04Encrypt"
 * @param kind - event kind (for signEvent)
 * @returns permission key or null if unresolvable
 */
export function permissionKey(method: string, kind?: number | null): string {
  if (method === 'signEvent' && kind !== undefined && kind !== null) {
    return `signEvent:${kind}`;
  }
  return method;
}

/**
 * Check permission for a domain/method/kind combo with account awareness.
 * @param domain
 * @param method - e.g. "signEvent", "nip04Encrypt"
 * @param kind - event kind (for signEvent)
 * @param accountId - account ID (uses _default if omitted)
 * @returns "allow" | "deny" | "ask"
 */
export async function check(domain: string, method: string, kind?: number, accountId?: string): Promise<PermissionDecision> {
  const perms = await load();
  if (!perms[domain]) {
    return 'ask';
  }

  const useDefaults = await getUseGlobalDefaults();
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);
  const data = perms[domain][bucket];
  if (!data) {
    return 'ask';
  }

  // Cascade: kind-specific > method-level > wildcard > ask
  const kindKey = permissionKey(method, kind);
  const methodKey = method;

  // 1. Kind-specific (e.g. "signEvent:1") — only when kind is provided
  if (kindKey !== methodKey && data[kindKey]) {
    return data[kindKey];
  }

  // 2. Method-level (e.g. "signEvent")
  if (data[methodKey]) {
    return data[methodKey];
  }

  // 3. Wildcard
  if (data['*']) {
    return data['*'];
  }

  return 'ask';
}

/**
 * Save a permission decision using permissionKey mapping.
 * @param domain
 * @param method
 * @param kind
 * @param decision - "allow" | "deny"
 * @param accountId - account ID (uses _default if omitted)
 */
export async function save(domain: string, method: string, kind: number | null, decision: PermissionDecision, accountId?: string): Promise<void> {
  const perms = await load();
  const useDefaults = await getUseGlobalDefaults();
  // In global mode, always write to _default regardless of accountId
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);
  if (!perms[domain]) perms[domain] = {};
  if (!perms[domain][bucket]) perms[domain][bucket] = {};

  const key = permissionKey(method, kind);
  perms[domain][bucket][key] = decision;

  await browser.storage.local.set({ [STORAGE_KEY]: perms });
}

/**
 * Save a permission decision using a key directly (for UI use).
 * @param domain
 * @param key - permission key as-is (e.g. "signEvent:1", "sendMessages")
 * @param decision - "allow" | "deny"
 * @param accountId - account ID (uses _default if omitted)
 */
export async function saveDirect(domain: string, key: string, decision: PermissionDecision, accountId?: string): Promise<void> {
  const perms = await load();
  const useDefaults = await getUseGlobalDefaults();
  // In global mode, always write to _default regardless of accountId
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);
  if (!perms[domain]) perms[domain] = {};
  if (!perms[domain][bucket]) perms[domain][bucket] = {};
  perms[domain][bucket][key] = decision;
  await browser.storage.local.set({ [STORAGE_KEY]: perms });
}

/**
 * Migrate old cascade-style permissions to per-kind format.
 * Removes old blanket keys (signEvent, nip04Encrypt, etc., *) since
 * they are no longer meaningful in the per-kind model.
 */
export async function migrateToPerKind(): Promise<void> {
  const perms = await load();
  let changed = false;
  const OLD_KEYS = ['signEvent', 'nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt', '*'];
  for (const domain of Object.keys(perms)) {
    const target = perms[domain];
    // Handle both old flat format and new bucketed format
    if (target[DEFAULT_BUCKET]) {
      // Already migrated to per-account -- clean old keys from each bucket
      for (const bucket of Object.keys(target)) {
        if (typeof target[bucket] !== 'object') continue;
        for (const key of OLD_KEYS) {
          if ((target[bucket] as PermissionBucket)[key]) {
            delete (target[bucket] as PermissionBucket)[key];
            changed = true;
          }
        }
        if (Object.keys(target[bucket] as PermissionBucket).length === 0) {
          delete target[bucket];
        }
      }
    } else {
      // Old flat format
      for (const key of OLD_KEYS) {
        if ((target as Record<string, unknown>)[key]) {
          delete (target as Record<string, unknown>)[key];
          changed = true;
        }
      }
    }
    if (Object.keys(perms[domain]).length === 0) {
      delete perms[domain];
    }
  }
  if (changed) {
    await browser.storage.local.set({ [STORAGE_KEY]: perms });
  }
}

/**
 * Migrate flat per-domain permissions to per-account bucketed format.
 * Wraps existing flat entries under "_default".
 * Safe to call multiple times -- skips already-migrated domains.
 */
export async function migrateToPerAccount(): Promise<void> {
  const perms = await load();
  let changed = false;
  for (const domain of Object.keys(perms)) {
    const domainData = perms[domain];
    // Already migrated if it has _default bucket
    if (domainData[DEFAULT_BUCKET]) continue;
    // Check if this is a flat format (values are strings like "allow"/"deny")
    const hasFlat = Object.values(domainData).some(v => typeof v === 'string');
    if (!hasFlat) continue;
    // Move flat entries under _default
    const flat: PermissionBucket = {};
    for (const [key, val] of Object.entries(domainData)) {
      if (typeof val === 'string') {
        flat[key] = val as PermissionDecision;
        delete (domainData as Record<string, unknown>)[key];
      }
    }
    domainData[DEFAULT_BUCKET] = flat;
    changed = true;
  }
  if (changed) {
    await browser.storage.local.set({ [STORAGE_KEY]: perms });
  }
}

/**
 * Migrate any stored "forward" permission values to "ask".
 * Previously NIP-46 accounts used "forward" to auto-send to remote signer.
 * Now permissions are account-type-agnostic; "ask" is the conservative default.
 */
export async function migrateForwardToAsk(): Promise<void> {
  const perms = await load();
  let changed = false;
  for (const domain of Object.keys(perms)) {
    for (const bucket of Object.keys(perms[domain])) {
      if (typeof perms[domain][bucket] !== 'object') continue;
      for (const key of Object.keys(perms[domain][bucket] as PermissionBucket)) {
        if ((perms[domain][bucket] as PermissionBucket)[key] === ('forward' as PermissionDecision)) {
          (perms[domain][bucket] as PermissionBucket)[key] = 'ask';
          changed = true;
        }
      }
    }
  }
  if (changed) {
    await browser.storage.local.set({ [STORAGE_KEY]: perms });
  }
}

/**
 * Clear permissions for a domain (optionally per-account), or all permissions.
 * @param domain
 * @param accountId - if provided, only clear that account's rules for the domain
 */
export async function clear(domain?: string, accountId?: string): Promise<void> {
  if (!domain) {
    await browser.storage.local.remove(STORAGE_KEY);
    return;
  }
  const perms = await load();
  if (!perms[domain]) return;

  // Use the same mode-aware bucket resolution as save() and check()
  const useDefaults = await getUseGlobalDefaults();
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);

  delete perms[domain][bucket];
  if (Object.keys(perms[domain]).length === 0) {
    delete perms[domain];
  }
  await browser.storage.local.set({ [STORAGE_KEY]: perms });
}

/**
 * Remove all permission overrides for a specific account across all domains.
 * Called on account deletion.
 * @param accountId
 */
export async function clearForAccount(accountId: string): Promise<void> {
  if (!accountId || accountId === DEFAULT_BUCKET) return;
  const perms = await load();
  let changed = false;
  for (const domain of Object.keys(perms)) {
    if (perms[domain][accountId]) {
      delete perms[domain][accountId];
      changed = true;
      if (Object.keys(perms[domain]).length === 0) {
        delete perms[domain];
      }
    }
  }
  if (changed) {
    await browser.storage.local.set({ [STORAGE_KEY]: perms });
  }
}

/**
 * Deep-copy permissions from one account to another.
 * @param fromAccountId - source account (or "_default")
 * @param toAccountId - target account
 */
export async function copyPermissions(fromAccountId: string | null, toAccountId: string): Promise<void> {
  if (!toAccountId) return;
  const from = fromAccountId || DEFAULT_BUCKET;
  const perms = await load();
  let changed = false;
  for (const domain of Object.keys(perms)) {
    const source = perms[domain][from];
    if (source && Object.keys(source).length > 0) {
      perms[domain][toAccountId] = { ...source };
      changed = true;
    }
  }
  if (changed) {
    await browser.storage.local.set({ [STORAGE_KEY]: perms });
  }
}

/**
 * Get all permissions for the active mode's bucket.
 * Returns { domain: { permKey: decision } }.
 * @param accountId - account ID (used only in per-account mode)
 */
export async function getAll(accountId?: string): Promise<Record<string, PermissionBucket>> {
  const perms = await load();
  const useDefaults = await getUseGlobalDefaults();
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);
  const result: Record<string, PermissionBucket> = {};
  for (const domain of Object.keys(perms)) {
    const data = perms[domain][bucket];
    if (data && Object.keys(data).length > 0) {
      result[domain] = { ...data };
    }
  }
  return result;
}

/**
 * Get permissions for a specific domain using the active mode's bucket.
 * @param domain
 * @param accountId
 */
export async function getForDomain(domain: string, accountId?: string): Promise<PermissionBucket> {
  const perms = await load();
  if (!perms[domain]) return {};
  const useDefaults = await getUseGlobalDefaults();
  const bucket = useDefaults ? DEFAULT_BUCKET : (accountId || DEFAULT_BUCKET);
  return { ...(perms[domain][bucket] || {}) };
}

/**
 * Get raw storage tree for all domains (for computing diff indicators in UI).
 */
export async function getAllRaw(): Promise<PermissionMap> {
  return load();
}

/**
 * Get raw buckets for a single domain (for diff computation).
 * @param domain
 */
export async function getForDomainRaw(domain: string): Promise<DomainPermissions> {
  const perms = await load();
  return perms[domain] || {};
}

/**
 * Get whether global default permissions mode is active.
 * When true, ONLY _default bucket is used for reads and writes.
 * When false, ONLY per-account buckets are used.
 */
export async function getUseGlobalDefaults(): Promise<boolean> {
  const data = await browser.storage.local.get(GLOBAL_DEFAULTS_KEY);
  // Default to true for backward compatibility
  return data[GLOBAL_DEFAULTS_KEY] !== false;
}

/**
 * Set whether global default permissions mode is active.
 * When true, ONLY _default bucket is used. When false, ONLY per-account buckets.
 * @param enabled
 */
export async function setUseGlobalDefaults(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [GLOBAL_DEFAULTS_KEY]: !!enabled });
}

async function load(): Promise<PermissionMap> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as PermissionMap) || {};
}
