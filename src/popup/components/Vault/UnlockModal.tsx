import React, { useEffect, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { useAccount } from '../../context/AccountContext';
import { useVault } from '../../context/VaultContext';
import useVaultUnlock from '@shared/hooks/useVaultUnlock.js';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import Button from '@components/Button/Button';
import styles from './UnlockModal.module.css';

interface WaiterInfo {
  id: string;
  type: string;
  origin: string;
  [key: string]: any;
}

interface UnlockModalProps {
  visible: boolean;
  message?: string;
  unlockWaiters?: WaiterInfo[];
  onUnlocked?: () => void;
  onCancel?: () => void;
}

function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    signEvent: t('approval.signEvent'),
    nip04Encrypt: t('approval.nip04Encrypt'),
    nip04Decrypt: t('approval.nip04Decrypt'),
    nip44Encrypt: t('approval.nip44Encrypt'),
    nip44Decrypt: t('approval.nip44Decrypt'),
    getPublicKey: t('activity.getPublicKey'),
  };
  return labels[type] || type;
}

export default function UnlockModal({ visible, message, unlockWaiters, onUnlocked, onCancel }: UnlockModalProps) {
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

  const handleCancelAll = async () => {
    await rpc('signer_cancelUnlockWaiters');
    reset();
    onCancel?.();
  };

  const handleCancelOne = async (id: string) => {
    await rpc('signer_cancelUnlockWaiter', { id });
  };

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
        {unlockWaiters && unlockWaiters.length > 0 && (
          <div className={styles.waitingEvents}>
            <div className={styles.waitingLabel}>{t('unlock.pendingEvents')}</div>
            {unlockWaiters.map((w) => (
              <div key={w.id} className={styles.waitingEvent}>
                <span className={styles.waitingEventLabel}>{getEventLabel(w.type)}</span>
                <span className={styles.waitingEventOrigin}>{w.origin}</span>
                <button className={styles.waitingEventDismiss} onClick={() => handleCancelOne(w.id)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.actions}>
          <Button
            variant="secondary"
            small
            onClick={handleCancelAll}
          >
            {t('common.cancel')}
          </Button>
          <Button small onClick={unlock}>{t('common.unlock')}</Button>
        </div>
      </div>
    </div>
  );
}
