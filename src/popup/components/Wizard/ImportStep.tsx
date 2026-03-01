import React, { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

function detectType(val: string): 'ncryptsec' | 'nsec' | null {
  if (val.startsWith('ncryptsec1')) return 'ncryptsec';
  if (val.startsWith('nsec1') || /^[0-9a-f]{64}$/i.test(val)) return 'nsec';
  return null;
}

interface ImportStepProps {
  onNext: (account: any, upgradeId: string | null) => void;
}

export default function ImportStep({ onNext }: ImportStepProps) {
  const [input, setInput] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [typeHint, setTypeHint] = useState<string>('');
  const [pubkey, setPubkey] = useState<string>('');
  const [upgradeNotice, setUpgradeNotice] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const importType = detectType(input.trim());

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    setError('');
    setPubkey('');
    setUpgradeNotice('');

    const type = detectType(val.trim());
    if (type === 'ncryptsec') {
      setTypeHint(t('wizard.encryptedDetected'));
    } else if (type === 'nsec') {
      setTypeHint(t('wizard.privateKeyDetected'));
    } else if (val.trim()) {
      setTypeHint('');
    } else {
      setTypeHint('');
    }
  };

  const handleContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterKey')); return; }

    setLoading(true);
    setError('');

    try {
      if (importType === 'ncryptsec') {
        if (!password) { setError(t('wizard.enterDecryptPassword')); setLoading(false); return; }
        const result = await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNcryptsec', { ncryptsec: val, password, name: name || undefined });
        onNext(result.account, result.upgradeFromReadOnly || null);
      } else {
        const result = await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNsec', { input: val });
        const acct = result.account;
        setPubkey(acct.pubkey);
        if (result.upgradeFromReadOnly) {
          setUpgradeNotice(t('wizard.upgradeNotice'));
        }
        onNext(acct, result.upgradeFromReadOnly || null);
      }
    } catch (e: any) {
      setError(e.message || t('wizard.importFailed'));
    }
    setLoading(false);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.importTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.importDesc')}
      </p>

      <div className={styles.formGroup}>
        <label>{t('wizard.importLabel')}</label>
        <Input
          type="password"
          showToggle
          mono
          placeholder={t('wizard.importPlaceholder')}
          value={input}
          onChange={handleInputChange}
        />
        {typeHint && <div className={styles.importTypeHint}>{typeHint}</div>}
      </div>

      {importType === 'ncryptsec' && (
        <>
          <div className={styles.formGroup}>
            <label>{t('wizard.decryptionPassword')}</label>
            <Input
              type="password"
              showToggle
              placeholder={t('wizard.encPasswordUsed')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>{t('wizard.accountName')}</label>
            <Input
              placeholder={t('wizard.accountNamePlaceholder')}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
        </>
      )}

      {pubkey && (
        <div className={styles.derivedInfo}>
          <div className={styles.derivedField}>
            <label>{t('wizard.pubkey')}</label>
            <span>{pubkey.slice(0, 16)}...{pubkey.slice(-8)}</span>
          </div>
        </div>
      )}

      {upgradeNotice && <div className={styles.upgradeNotice}>{upgradeNotice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.stepActions}>
        <Button onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.importing') : importType === 'ncryptsec' ? t('wizard.decryptContinue') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
