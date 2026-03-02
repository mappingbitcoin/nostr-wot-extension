import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { AUTO_LOCK_OPTIONS } from '@shared/constants.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import styles from './WizardOverlay.module.css';

interface PasswordStepProps {
  account: any;
  upgradeId: string | null;
  onNext: (upgraded: boolean) => void;
}

export default function PasswordStep({ account, upgradeId, onNext }: PasswordStepProps) {
  const [password, setPassword] = useState<string>('');
  const [confirm, setConfirm] = useState<string>('');
  const [autoLockMs, setAutoLockMs] = useState<number>(900000); // 15 min default
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null); // null = checking
  const [needsUnlock, setNeedsUnlock] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const exists = await rpc<boolean>('vault_exists');
        if (!exists) { setVaultExists(false); return; }
        // Vault blob exists but may have no accounts (user removed all)
        // In that case, treat as new vault so user can set auto-lock
        const data: any = await browser.storage.local.get(['accounts']);
        const accts = data.accounts || [];
        if (accts.length === 0) { setVaultExists(false); return; }

        // Vault exists with accounts — auto-add without showing UI
        // First ensure vault is unlocked
        const locked = await rpc<boolean>('vault_isLocked');
        if (locked) {
          // Try empty password (Never-lock vaults)
          const ok = await rpc<boolean>('vault_unlock', { password: '' });
          if (!ok) { setNeedsUnlock(true); setVaultExists(true); return; }
        }
        // Vault unlocked — add account and proceed
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
        onNext(!!upgradeId);
      } catch {
        setVaultExists(false);
      }
    })();
  }, []);

  const isNever = autoLockMs === 0;

  const handleContinue = async () => {
    // Only validate password when creating a new vault
    if (!vaultExists && !isNever) {
      if (password.length < 8) { setError(t('wizard.passwordMin8')); return; }
      if (password !== confirm) { setError(t('wizard.passwordsNoMatch')); return; }
    }
    if (!account) { setError(t('wizard.noAccountData')); return; }

    setLoading(true);
    setError('');

    try {
      if (vaultExists) {
        // Add to existing vault -- does NOT overwrite
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
      } else {
        // Create new vault
        await rpc('onboarding_createVault', {
          password: isNever ? '' : password,
          account,
          autoLockMinutes: autoLockMs / 60000,
          upgradeFromReadOnly: upgradeId || null,
        });
      }

      onNext(!!upgradeId);
    } catch (e: any) {
      setError(e.message || t('wizard.failedCreateVault'));
    }
    setLoading(false);
  };

  // Still checking vault state
  if (vaultExists === null) return null;

  // Vault exists but locked — need password to unlock
  if (vaultExists && needsUnlock) {
    const handleUnlock = async () => {
      if (!password) return;
      setLoading(true);
      setError('');
      try {
        const ok = await rpc<boolean>('vault_unlock', { password });
        if (!ok) { setError(t('key.wrongPassword')); setLoading(false); return; }
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
        onNext(!!upgradeId);
      } catch (e: any) {
        setError(e.message || t('key.failedUnlock'));
        setLoading(false);
      }
    };

    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('wizard.addToVault')}</h2>
        <p className={styles.stepDesc}>{t('unlock.vaultLocked')}</p>

        <div className={styles.formGroup}>
          <label>{t('wizard.password')}</label>
          <Input
            type="password"
            showToggle
            placeholder={t('unlock.enterPassword')}
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleUnlock()}
            autoFocus
          />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.stepActions}>
          <Button onClick={handleUnlock} disabled={loading || !password}>
            {loading ? t('common.loading') : t('common.unlock')}
          </Button>
        </div>
      </div>
    );
  }

  // No vault -- full password setup
  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.protectYourKeys')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.protectYourKeysDesc')}
      </p>

      <div className={styles.formGroup}>
        <label>{t('wizard.autoLockTimer')}</label>
        <ChipGroup
          options={AUTO_LOCK_OPTIONS.map((opt: any) => ({ value: opt.ms, label: t(opt.labelKey) }))}
          value={autoLockMs}
          onChange={(v: number) => { setAutoLockMs(v); setError(''); }}
        />
      </div>

      {isNever && (
        <div className={styles.warningBox}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{t('wizard.neverLockWarning')}</span>
        </div>
      )}

      {!isNever && (
        <>
          <div className={styles.formGroup}>
            <label>{t('wizard.password')}</label>
            <Input
              type="password"
              showToggle
              placeholder={t('wizard.minEightChars')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
            />
          </div>

          <div className={styles.formGroup}>
            <label>{t('wizard.confirmPw')}</label>
            <Input
              type="password"
              placeholder={t('wizard.reEnterPw')}
              value={confirm}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setConfirm(e.target.value); setError(''); }}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleContinue()}
            />
          </div>
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.stepActions}>
        <Button onClick={handleContinue} disabled={loading}>
          {loading ? t('wizard.creatingVault') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
