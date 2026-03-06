/**
 * Wallet provider factory with per-account caching
 *
 * Creates and caches WalletProvider instances keyed by account ID.
 * Pattern mirrors `_nip46Clients` map in `lib/signer.ts`.
 *
 * NWC providers require crypto dependencies injected at runtime, so they
 * cannot be constructed here — use `setWalletProvider()` to cache an
 * externally-created NwcProvider instance.
 *
 * @module lib/wallet/index
 */

import type { WalletConfig, WalletProvider } from './types.ts';
import { LnbitsProvider } from './lnbits.ts';

export type { WalletConfig, WalletProvider, WalletProviderInfo, SafeWalletInfo } from './types.ts';

// ── Per-account provider cache ──

const _providers: Map<string, WalletProvider> = new Map();

/**
 * Get a cached WalletProvider for the given account, or create one.
 *
 * Returns null if config is undefined/null.
 * For 'lnbits' configs, creates an LnbitsProvider directly.
 * For 'nwc' configs, throws — NWC needs crypto deps injected at runtime;
 * use `createNwcProvider()` externally and pass via `setWalletProvider()`.
 */
export function getWalletProvider(
  accountId: string,
  config: WalletConfig | undefined | null,
): WalletProvider | null {
  if (config === undefined || config === null) {
    return null;
  }

  const cached = _providers.get(accountId);
  if (cached) {
    return cached;
  }

  if (config.type === 'lnbits') {
    const provider = new LnbitsProvider({
      instanceUrl: config.instanceUrl,
      adminKey: config.adminKey,
    });
    _providers.set(accountId, provider);
    return provider;
  }

  if (config.type === 'nwc') {
    throw new Error('Use createNwcProvider() for NWC accounts');
  }

  return null;
}

/**
 * Cache an externally-created provider (e.g. NwcProvider with injected deps).
 */
export function setWalletProvider(accountId: string, provider: WalletProvider): void {
  _providers.set(accountId, provider);
}

/**
 * Disconnect and remove a cached provider.
 */
export function removeWalletProvider(accountId: string): void {
  const provider = _providers.get(accountId);
  if (provider) {
    provider.disconnect();
    _providers.delete(accountId);
  }
}

/**
 * Disconnect all cached providers and clear the cache.
 * Called on vault lock to ensure no stale connections remain.
 */
export function clearWalletProviders(): void {
  for (const provider of _providers.values()) {
    provider.disconnect();
  }
  _providers.clear();
}

/**
 * Returns true if the config is defined and not null (i.e. a wallet is configured).
 */
export function hasWalletConfig(config: WalletConfig | undefined | null): boolean {
  return config !== undefined && config !== null;
}
