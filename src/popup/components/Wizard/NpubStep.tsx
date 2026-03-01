import React, { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface NpubStepProps {
  onNext: (account: any) => void;
}

export default function NpubStep({ onNext }: NpubStepProps) {
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterPublicKey')); return; }

    setLoading(true);
    setError('');

    try {
      const result = await rpc<{ account: any }>('onboarding_validateNpub', { input: val });

      // Save read-only account
      await rpc('onboarding_saveReadOnly', { account: result.account });

      onNext(result.account);
    } catch (e: any) {
      setError(e.message || t('wizard.invalidPublicKey'));
    }
    setLoading(false);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.npubTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.npubDesc')}
      </p>

      <div className={styles.formGroup}>
        <label>{t('wizard.npubLabel')}</label>
        <Input
          mono
          placeholder={t('wizard.npubPlaceholder')}
          value={input}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setInput(e.target.value); setError(''); }}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.stepActions}>
        <Button onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.validating') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
