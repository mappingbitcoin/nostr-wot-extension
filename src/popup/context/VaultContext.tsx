import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';

interface VaultContextValue {
  exists: boolean;
  locked: boolean;
  autoLockEnabled: boolean;
  isNip46: boolean;
  isGenerated: boolean;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  checkState: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

interface VaultProviderProps {
  children: ReactNode;
}

export function VaultProvider({ children }: VaultProviderProps) {
  const [exists, setExists] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(true);
  const [autoLockEnabled, setAutoLockEnabled] = useState<boolean>(false);
  const [isNip46, setIsNip46] = useState<boolean>(false);
  const [isGenerated, setIsGenerated] = useState<boolean>(false);

  const checkState = useCallback(async () => {
    try {
      const [existsResult, lockedResult, autoLockMs, acctType] = await Promise.all([
        rpc('vault_exists'),
        rpc('vault_isLocked'),
        rpc<number>('vault_getAutoLock'),
        rpc<{ type?: string }>('vault_getActiveAccountType'),
      ]);
      setExists(!!existsResult);
      setLocked(!!lockedResult);
      setAutoLockEnabled(autoLockMs > 0);
      setIsNip46(acctType?.type === 'nip46');
      setIsGenerated(acctType?.type === 'generated');
    } catch {
      setExists(false);
      setLocked(true);
      setAutoLockEnabled(false);
      setIsNip46(false);
      setIsGenerated(false);
    }
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const result = await rpc('vault_unlock', { password });
    if (result) {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  const lock = useCallback(async () => {
    await rpc('vault_lock');
    setLocked(true);
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  // Re-check vault state when active account changes
  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) {
      if (area === 'local' && changes.activeAccountId) {
        checkState();
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [checkState]);

  const value: VaultContextValue = {
    exists,
    locked,
    autoLockEnabled,
    isNip46,
    isGenerated,
    unlock,
    lock,
    checkState,
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within VaultProvider');
  return ctx;
}
