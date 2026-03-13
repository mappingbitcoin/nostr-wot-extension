import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';

interface RawPerms {
  [domain: string]: {
    [bucket: string]: {
      [permKey: string]: string;
    };
  };
}

interface PermissionsContextValue {
  rawPerms: RawPerms;
  useGlobalDefaults: boolean;
  loaded: boolean;
  reload: () => Promise<void>;
  savePermission: (domain: string, permKey: string, decision: string, accountId?: string | null) => Promise<void>;
  clearPermissions: (domain: string, accountId?: string | null) => Promise<void>;
  copyPermissions: (fromAccountId: string, toAccountId: string) => Promise<void>;
  setUseGlobalDefaults: (enabled: boolean) => Promise<void>;
  getForBucket: (domain: string, accountId?: string | null) => Record<string, string>;
  getDomainsForBucket: (accountId?: string | null) => string[];
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

interface PermissionsProviderProps {
  children: ReactNode;
}

export function PermissionsProvider({ children }: PermissionsProviderProps) {
  const [rawPerms, setRawPerms] = useState<RawPerms>({});
  const [useGlobalDefaults, setUseGlobalDefaultsState] = useState<boolean>(true);
  const [loaded, setLoaded] = useState<boolean>(false);

  // ── Load from storage ──
  const reload = useCallback(async () => {
    const [raw, defaults] = await Promise.all([
      rpc<RawPerms>('signer_getPermissionsRaw'),
      rpc<boolean>('signer_getUseGlobalDefaults'),
    ]);
    setRawPerms(raw || {});
    setUseGlobalDefaultsState(defaults !== false);
    setLoaded(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // ── Listen for storage changes ──
  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) {
      if (area === 'local' && (changes.signerPermissions || changes.signerUseGlobalDefaults)) {
        reload();
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [reload]);

  // ── Mutations ──

  /** Save a permission using a pre-computed permKey (e.g. "signEvent:1") */
  const savePermission = useCallback(async (domain: string, permKey: string, decision: string, accountId?: string | null) => {
    await rpc('signer_savePermission', {
      domain, methodName: permKey, decision, accountId,
    });
    // Optimistic local update — use the same mode logic as the backend
    setRawPerms(prev => {
      const next = { ...prev };
      const bucket = useGlobalDefaults ? '_default' : (accountId || '_default');
      if (!next[domain]) next[domain] = {};
      if (!next[domain][bucket]) next[domain][bucket] = {};
      next[domain][bucket] = { ...next[domain][bucket], [permKey]: decision };
      return next;
    });
  }, [useGlobalDefaults]);

  /** Clear permissions for a domain (optionally per-account) */
  const clearPermissions = useCallback(async (domain: string, accountId?: string | null) => {
    await rpc('signer_clearPermissions', { domain, accountId });
    reload();
  }, [reload]);

  /** Copy permissions from one account to another */
  const copyPermissions = useCallback(async (fromAccountId: string, toAccountId: string) => {
    await rpc('signer_copyPermissions', { fromAccountId, toAccountId });
    reload();
  }, [reload]);

  /** Toggle the global defaults cascade */
  const setUseGlobalDefaults = useCallback(async (enabled: boolean) => {
    setUseGlobalDefaultsState(enabled);
    await rpc('signer_setUseGlobalDefaults', { enabled });
  }, []);

  /** Get permissions for a specific bucket (accountId or '_default') */
  const getForBucket = useCallback((domain: string, accountId?: string | null): Record<string, string> => {
    const bucket = accountId || '_default';
    return rawPerms[domain]?.[bucket] || {};
  }, [rawPerms]);

  /** Get all domains that have permissions for a specific bucket */
  const getDomainsForBucket = useCallback((accountId?: string | null): string[] => {
    const bucket = accountId || '_default';
    const domains: string[] = [];
    for (const domain of Object.keys(rawPerms)) {
      const b = rawPerms[domain]?.[bucket];
      if (b && Object.keys(b).length > 0) {
        domains.push(domain);
      }
    }
    return domains;
  }, [rawPerms]);

  const value: PermissionsContextValue = {
    rawPerms,
    useGlobalDefaults,
    loaded,
    reload,
    savePermission,
    clearPermissions,
    copyPermissions,
    setUseGlobalDefaults,
    getForBucket,
    getDomainsForBucket,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used within PermissionsProvider');
  return ctx;
}
