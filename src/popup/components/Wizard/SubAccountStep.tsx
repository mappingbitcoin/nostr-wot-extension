import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface SubAccountStepProps {
  onNext: (account: any) => void;
}

export default function SubAccountStep({ onNext }: SubAccountStepProps) {
  const [account, setAccount] = useState<any>(null);
  const [derivationIndex, setDerivationIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [password, setPassword] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await rpc<{ account: any; derivationIndex: number }>('onboarding_generateSubAccount', {});
      setAccount(result.account);
      setDerivationIndex(result.derivationIndex);
      setNeedsUnlock(false);
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('locked')) {
        setNeedsUnlock(true);
      } else {
        setError(msg || t('wizard.failedGenerate'));
      }
    }
    setLoading(false);
  };

  useEffect(() => { generate(); }, []);

  const handleUnlock = async () => {
    if (!password) return;
    setError('');
    setSaving(true);
    try {
      const ok = await rpc<boolean>('vault_unlock', { password });
      if (ok) {
        setPassword('');
        await generate();
      } else {
        setError(t('key.wrongPassword'));
      }
    } catch (e: any) {
      setError(e.message || t('key.failedUnlock'));
    }
    setSaving(false);
  };

  const handleContinue = async () => {
    if (!account) return;
    setSaving(true);
    setError('');
    try {
      await rpc('onboarding_addToVault', { account, upgradeFromReadOnly: null });
      onNext(account);
    } catch (e: any) {
      setError(e.message || t('wizard.failedCreateVault'));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('wizard.generatingIdentity')}</h2>
        <p className={styles.stepDesc}>{t('wizard.creatingKeypair')}</p>
      </div>
    );
  }

  if (needsUnlock) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('wizard.subAccountTitle')}</h2>
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
          <Button onClick={handleUnlock} disabled={saving || !password}>
            {saving ? t('common.loading') : t('common.unlock')}
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('common.error')}</h2>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.subAccountTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.subAccountDesc')}
      </p>

      <div className={styles.infoBox}>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>{t('wizard.typeLabel')}</span>
          <span>{t('wizard.subAccountType')}</span>
        </div>
        <div className={styles.infoRow}>
          <span className={styles.infoLabel}>{t('wizard.derivationPath')}</span>
          <span className={styles.mono}>m/44'/1237'/0'/0/{derivationIndex}</span>
        </div>
        {account?.pubkey && (
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>{t('wizard.publicKeyLabel')}</span>
            <span className={styles.mono}>{account.pubkey.slice(0, 12)}...{account.pubkey.slice(-8)}</span>
          </div>
        )}
      </div>

      <p className={styles.hintText}>
        {t('wizard.subAccountHint')}
      </p>

      <div className={styles.stepActions}>
        <Button onClick={handleContinue} disabled={saving}>
          {saving ? t('wizard.addingAccount') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
