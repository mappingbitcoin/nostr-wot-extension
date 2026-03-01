import React, { useEffect, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { useAccount } from '../../context/AccountContext';
import { useVault } from '../../context/VaultContext';
import useVaultUnlock from '@shared/hooks/useVaultUnlock.js';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import Button from '@components/Button/Button';
import styles from './UnlockModal.module.css';

interface UnlockModalProps {
  visible: boolean;
  message?: string;
  onUnlocked?: () => void;
  onCancel?: () => void;
}

export default function UnlockModal({ visible, message, onUnlocked, onCancel }: UnlockModalProps) {
  const { displayName, avatarUrl, initial } = useAccount();
  const vault = useVault();

  const handleSuccess = useCallback(() => {
    vault.checkState();
    onUnlocked?.();
  }, [vault, onUnlocked]);

  const { password, setPassword, error, inputRef, unlock, reset, focus } =
    useVaultUnlock({
      onSuccess: handleSuccess,
      messages: {
        wrongPassword: t('key.wrongPassword'),
        unlockFailed: t('key.failedUnlock'),
      },
    });

  // Auto-unlock for "Never" mode vaults (encrypted with empty password)
  useEffect(() => {
    if (visible && !vault.autoLockEnabled && vault.locked) {
      rpc<boolean>('vault_unlock', { password: '' }).then((ok) => {
        if (ok) handleSuccess();
      }).catch(() => {});
    }
  }, [visible, vault.autoLockEnabled, vault.locked, handleSuccess]);

  const { shouldRender, animating } = useAnimatedVisible(visible);

  useEffect(() => {
    if (visible) {
      reset();
      focus();
    }
  }, [visible, reset, focus]);

  if (!shouldRender) return null;

  return (
    <div className={`${styles.overlay} ${animating ? styles.exiting : ''}`}>
      <div className={`${styles.card} ${animating ? styles.cardExiting : ''}`}>
        <div className={styles.account}>
          {avatarUrl ? (
            <img className={styles.avatar} src={avatarUrl} alt="" />
          ) : (
            <div className={styles.avatarFallback}>{initial}</div>
          )}
          <div className={styles.name}>{displayName}</div>
        </div>
        <div className={styles.count}>{message || t('unlock.vaultLocked')}</div>
        <input
          ref={inputRef}
          type="password"
          className={styles.input}
          placeholder={t('unlock.enterPassword')}
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && unlock()}
          autoComplete="off"
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.actions}>
          <Button
            variant="secondary"
            small
            onClick={() => {
              reset();
              onCancel?.();
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button small onClick={unlock}>{t('common.unlock')}</Button>
        </div>
      </div>
    </div>
  );
}
