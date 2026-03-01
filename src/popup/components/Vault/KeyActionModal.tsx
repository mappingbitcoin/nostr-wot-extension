import React, { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { IconClose, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import useVaultUnlock from '@shared/hooks/useVaultUnlock.js';
import { useVault } from '../../context/VaultContext';
import styles from './KeyActionModal.module.css';

interface KeyActionModalProps {
  action: string;
  onClose: () => void;
}

export default function KeyActionModal({ action, onClose }: KeyActionModalProps) {
  const vault = useVault();
  const [needsUnlock, setNeedsUnlock] = useState<boolean>(false);

  // nsec state
  const [nsecValue, setNsecValue] = useState<string>('');
  const [nsecRevealed, setNsecRevealed] = useState<boolean>(false);
  const [nsecBlurred, setNsecBlurred] = useState<boolean>(true);
  const autoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ncryptsec state
  const [ncPassword, setNcPassword] = useState<string>('');
  const [ncConfirm, setNcConfirm] = useState<string>('');
  const [ncValue, setNcValue] = useState<string>('');
  const [ncError, setNcError] = useState<string>('');
  const [ncGenerating, setNcGenerating] = useState<boolean>(false);

  // change password state
  const [cpCurrent, setCpCurrent] = useState<string>('');
  const [cpNew, setCpNew] = useState<string>('');
  const [cpConfirm, setCpConfirm] = useState<string>('');
  const [cpError, setCpError] = useState<string>('');
  const [cpSuccess, setCpSuccess] = useState<boolean>(false);

  const titles: Record<string, string> = { nsec: t('key.exportTitle'), ncryptsec: t('key.exportEncTitle'), changePassword: t('key.changePasswordTitle') };

  const {
    password: unlockPw,
    setPassword: setUnlockPw,
    error: unlockError,
    unlock: handleUnlock,
  } = useVaultUnlock({
    onSuccess: () => { setNeedsUnlock(false); vault.checkState(); },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const locked = await rpc<boolean>('vault_isLocked');
        if (!locked) { setNeedsUnlock(false); return; }
        // In never-lock mode (autoLockMs === 0), auto-unlock with empty password
        const autoLockMs = await rpc<number>('vault_getAutoLock');
        if (autoLockMs === 0) {
          const ok = await rpc<boolean>('vault_unlock', { password: '' });
          if (ok) { setNeedsUnlock(false); vault.checkState?.(); return; }
        }
        setNeedsUnlock(true);
      } catch { /* ignore */ }
    })();
    return () => {
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
    };
  }, []);

  const handleClose = () => {
    if (autoHideRef.current) clearTimeout(autoHideRef.current);
    setNsecValue('');
    setNcValue('');
    onClose();
  };

  // --- nsec ---
  const revealNsec = async () => {
    try {
      const nsec = await rpc<string>('vault_exportNsec');
      if (nsec) {
        setNsecValue(nsec);
        setNsecRevealed(true);
        setNsecBlurred(true);
        // Auto-hide after 30s
        autoHideRef.current = setTimeout(() => {
          setNsecValue('');
          setNsecRevealed(false);
          setNsecBlurred(true);
        }, 30000);
      }
    } catch { /* ignore */ }
  };

  const copyNsec = () => {
    navigator.clipboard.writeText(nsecValue);
  };

  // --- ncryptsec ---
  const generateNcryptsec = async () => {
    setNcError('');
    if (ncPassword.length < 8) { setNcError(t('key.passwordMin8')); return; }
    if (ncPassword !== ncConfirm) { setNcError(t('key.passwordsNoMatch')); return; }
    setNcGenerating(true);
    try {
      const result = await rpc<string>('vault_exportNcryptsec', { password: ncPassword });
      if (result) setNcValue(result);
      else setNcError(t('key.failedExport'));
    } catch {
      setNcError(t('key.failedExport'));
    }
    setNcGenerating(false);
  };

  const copyNcryptsec = () => {
    navigator.clipboard.writeText(ncValue);
  };

  // --- change password ---
  const handleChangePassword = async () => {
    setCpError('');
    if (!cpCurrent) { setCpError(t('key.enterCurrentPassword')); return; }
    if (cpNew.length < 8) { setCpError(t('key.newPasswordMin8')); return; }
    if (cpNew !== cpConfirm) { setCpError(t('key.passwordsNoMatch')); return; }
    try {
      const result = await rpc<{ success?: boolean; error?: string }>('vault_changePassword', { currentPassword: cpCurrent, newPassword: cpNew });
      if (result?.success) {
        setCpSuccess(true);
        setTimeout(handleClose, 1500);
      } else {
        setCpError(result?.error || t('key.failedChangePassword'));
      }
    } catch {
      setCpError(t('key.failedChangePassword'));
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>{titles[action] || t('key.keyAction')}</span>
          <button className={styles.closeBtn} onClick={handleClose}>
            <IconClose />
          </button>
        </div>

        {needsUnlock ? (
          <div className={styles.section}>
            <label>{t('key.unlockToContinue')}</label>
            <Input
              type="password"
              showToggle
              placeholder={t('key.vaultPassword')}
              value={unlockPw}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUnlockPw(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleUnlock()}
            />
            {unlockError && <div className={styles.error}>{unlockError}</div>}
            <div className={styles.actions}>
              <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
              <Button small onClick={handleUnlock}>{t('common.unlock')}</Button>
            </div>
          </div>
        ) : action === 'nsec' ? (
          <div className={styles.section}>
            {!nsecRevealed ? (
              <>
                <div className={styles.warning}>
                  <IconWarning />
                  <span>{t('key.nsecWarning')}</span>
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button variant="danger" small onClick={revealNsec}>{t('key.revealKey')}</Button>
                </div>
              </>
            ) : (
              <>
                <div
                  className={`${styles.keyDisplay} ${nsecBlurred ? styles.blurred : ''}`}
                  onClick={() => setNsecBlurred((b) => !b)}
                >
                  {nsecValue}
                </div>
                <div className={styles.hint}>{`${t(nsecBlurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.autoHideHint')}`}</div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
                  <Button small onClick={copyNsec}>{t('common.copy')}</Button>
                </div>
              </>
            )}
          </div>
        ) : action === 'ncryptsec' ? (
          <div className={styles.section}>
            {!ncValue ? (
              <>
                <label>{t('key.encryptionPassword')}</label>
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.passwordMinChars')}
                  value={ncPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNcPassword(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder={t('key.confirmPassword')}
                  value={ncConfirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNcConfirm(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && generateNcryptsec()}
                />
                {ncError && <div className={styles.error}>{ncError}</div>}
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button small onClick={generateNcryptsec} disabled={ncGenerating}>
                    {ncGenerating ? t('key.generating') : t('key.generate')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.keyDisplay}>{ncValue}</div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
                  <Button small onClick={copyNcryptsec}>{t('common.copy')}</Button>
                </div>
              </>
            )}
          </div>
        ) : action === 'changePassword' ? (
          <div className={styles.section}>
            {cpSuccess ? (
              <div className={styles.success}>{t('key.passwordChanged')}</div>
            ) : (
              <>
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.currentPw')}
                  value={cpCurrent}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpCurrent(e.target.value)}
                />
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.newPwMinChars')}
                  value={cpNew}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpNew(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder={t('key.confirmNewPw')}
                  value={cpConfirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpConfirm(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleChangePassword()}
                />
                {cpError && <div className={styles.error}>{cpError}</div>}
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button small onClick={handleChangePassword}>{t('common.save')}</Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
