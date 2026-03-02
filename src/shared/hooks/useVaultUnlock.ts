import { useState, useRef, useCallback } from 'react';
import { rpc } from '@shared/rpc.ts';

interface VaultUnlockMessages {
  enterPassword?: string;
  wrongPassword?: string;
  unlockFailed?: string;
}

interface UseVaultUnlockOptions {
  onSuccess?: () => void;
  messages?: VaultUnlockMessages;
}

interface UseVaultUnlockResult {
  password: string;
  setPassword: (pw: string) => void;
  error: string;
  setError: (err: string) => void;
  loading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  unlock: () => Promise<boolean>;
  reset: () => void;
  focus: () => void;
}

const DEFAULT_MESSAGES: Required<VaultUnlockMessages> = {
  enterPassword: 'Enter password',
  wrongPassword: 'Wrong password',
  unlockFailed: 'Unlock failed',
};

export default function useVaultUnlock({ onSuccess, messages }: UseVaultUnlockOptions = {}): UseVaultUnlockResult {
  const msg = messages ? { ...DEFAULT_MESSAGES, ...messages } : DEFAULT_MESSAGES;
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = useCallback((): void => {
    setPassword('');
    setError('');
    setLoading(false);
  }, []);

  const focus = useCallback((): void => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (!password) { setError(msg.enterPassword); return false; }
    setLoading(true);
    setError('');
    try {
      const ok = await rpc<boolean>('vault_unlock', { password });
      if (ok) {
        setPassword('');
        onSuccess?.();
        return true;
      } else {
        setError(msg.wrongPassword);
        inputRef.current?.select();
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || msg.unlockFailed);
      inputRef.current?.select();
      return false;
    } finally {
      setLoading(false);
    }
  }, [password, onSuccess, msg]);

  return { password, setPassword, error, setError, loading, inputRef, unlock, reset, focus };
}
