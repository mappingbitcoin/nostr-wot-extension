import React, { useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import useVaultUnlock from '@shared/hooks/useVaultUnlock.ts';
import styles from '../PromptApp.module.css';

interface UnlockSectionProps {
  onUnlocked: () => void;
}

export default function UnlockSection({ onUnlocked }: UnlockSectionProps) {
  const { password, setPassword, error, setError, loading, inputRef, unlock } =
    useVaultUnlock({ onSuccess: onUnlocked });

  // Auto-unlock for "Never" mode vaults (encrypted with empty password)
  useEffect(() => {
    rpc<number>('vault_getAutoLock').then((ms) => {
      if (ms === 0) {
        rpc<boolean>('vault_unlock', { password: '' }).then((ok) => {
          if (ok) onUnlocked?.();
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [onUnlocked]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={styles.unlockSection}>
      <span className={styles.unlockLabel}>{t('prompt.vaultLocked')}</span>
      <input
        ref={inputRef}
        className={styles.unlockInput}
        type="password"
        placeholder={t('prompt.enterVaultPassword')}
        autoComplete="off"
        value={password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && unlock()}
        disabled={loading}
      />
      {error && <span className={styles.unlockError}>{error}</span>}
    </div>
  );
}
