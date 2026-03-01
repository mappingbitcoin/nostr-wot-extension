import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { rpc } from '@shared/rpc.ts';

interface VaultContextValue {
  exists: boolean;
  locked: boolean;
  autoLockEnabled: boolean;
  isNip46: boolean;
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

  const checkState = useCallback(async () => {
    try {
      const existsResult = await rpc('vault_exists');
      setExists(!!existsResult);

      const lockedResult = await rpc('vault_isLocked');
      setLocked(!!lockedResult);

      const autoLockMs = await rpc<number>('vault_getAutoLock');
      setAutoLockEnabled(autoLockMs > 0);

      const acctType = await rpc<{ type?: string }>('vault_getActiveAccountType');
      setIsNip46(acctType?.type === 'nip46');
    } catch {
      setExists(false);
      setLocked(true);
      setAutoLockEnabled(false);
      setIsNip46(false);
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

  const value: VaultContextValue = {
    exists,
    locked,
    autoLockEnabled,
    isNip46,
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
