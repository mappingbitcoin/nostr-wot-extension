import React, { useState, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface SubAccountStepProps {
  onNext: (account: any) => void;
}

export default function SubAccountStep({ onNext }: SubAccountStepProps) {
  const [account, setAccount] = useState<any>(null);
  const [derivationIndex, setDerivationIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const result = await rpc<{ account: any; derivationIndex: number }>('onboarding_generateSubAccount', {});
        setAccount(result.account);
        setDerivationIndex(result.derivationIndex);
      } catch (e: any) {
        setError(e.message || t('wizard.failedGenerate'));
      }
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className={styles.step}>
        <h2 className={styles.stepTitle}>{t('wizard.generatingIdentity')}</h2>
        <p className={styles.stepDesc}>{t('wizard.creatingKeypair')}</p>
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
        <Button onClick={() => onNext(account)}>
          {t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
