import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub, getInitial } from '@shared/format/text.ts';
import { rpc } from '@shared/rpc.ts';

interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
}

interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  banner?: string;
}

interface ProfileCache {
  [pubkey: string]: ProfileMetadata;
}

interface AccountContextValue {
  accounts: Account[] | null;
  active: Account | null;
  activeId: string | null;
  cachedProfile: ProfileMetadata | null;
  profileCache: ProfileCache;
  switchAccount: (accountId: string) => Promise<void>;
  reload: () => void;
  isReadOnly: boolean;
  isNip46: boolean;
  displayName: string;
  displaySub: string;
  avatarUrl: string | null;
  initial: string;
}

const AccountContext = createContext<AccountContextValue | null>(null);

interface AccountProviderProps {
  children: ReactNode;
}

export function AccountProvider({ children }: AccountProviderProps) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [profileCache, setProfileCache] = useState<ProfileCache>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  const active = accounts?.find((a) => a.id === activeId) || accounts?.[0] || null;

  const load = useCallback(async () => {
    const data: any = await browser.storage.local.get(['accounts', 'activeAccountId', 'profileCache']);
    const accts: Account[] = data.accounts || [];
    const id: string = data.activeAccountId || '';

    setAccounts(accts);
    setActiveId(id || accts[0]?.id || null);
    setProfileCache(data.profileCache || {});
  }, []);

  // Fetch kind:0 metadata for all accounts in the background.
  // Shows cached data immediately; refreshes from relays each popup open.
  useEffect(() => {
    if (!accounts || accounts.length === 0) return;

    const pubkeys = [...new Set(accounts.map((a) => a.pubkey).filter(Boolean))];
    // Only fetch pubkeys we haven't already kicked off this session
    const toFetch = pubkeys.filter((pk) => !fetchedRef.current.has(pk));
    if (toFetch.length === 0) return;
    toFetch.forEach((pk) => fetchedRef.current.add(pk));

    // Fire all fetches concurrently, update cache as each resolves
    for (const pk of toFetch) {
      rpc<ProfileMetadata | null>('getProfileMetadata', { pubkey: pk })
        .then(async (metadata) => {
          if (!metadata) return;
          const data: any = await browser.storage.local.get('profileCache');
          const pc: ProfileCache = data.profileCache || {};
          pc[pk] = metadata;
          await browser.storage.local.set({ profileCache: pc });
          // State update will happen via storage.onChanged listener
        })
        .catch(() => {}); // Relay failures are fine — we keep cached data
    }
  }, [accounts]);

  const switchAccount = useCallback(async (accountId: string) => {
    const account = accounts?.find((a) => a.id === accountId);
    if (!account) return;
    setActiveId(accountId);
    await rpc('switchAccount', { accountId });
    // Reload active tab so injected NIP-07 content reflects the new identity
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) browser.tabs.reload(tabs[0].id);
    } catch { /* ignore — fails on chrome:// pages */ }
  }, [accounts]);

  const reload = useCallback(() => load(), [load]);

  useEffect(() => {
    load();
  }, [load]);

  // Listen for storage changes to accounts
  useEffect(() => {
    function onChange(changes: Record<string, any>, area: string) {
      if (area === 'local' && (changes.accounts || changes.activeAccountId || changes.profileCache)) {
        load();
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [load]);

  const cachedProfile = active ? profileCache[active.pubkey] : null;

  const value: AccountContextValue = {
    accounts,
    active,
    activeId,
    cachedProfile,
    profileCache,
    switchAccount,
    reload,
    isReadOnly: active?.readOnly === true || active?.type === 'npub',
    isNip46: active?.type === 'nip46',
    displayName: cachedProfile?.name || active?.name || t('topbar.noAccounts'),
    displaySub: active ? (cachedProfile?.nip05 || truncateNpub(active.pubkey)) : t('topbar.addToStart'),
    avatarUrl: cachedProfile?.picture || null,
    initial: getInitial(cachedProfile?.name || active?.name),
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
