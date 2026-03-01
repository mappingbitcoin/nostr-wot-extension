import React, { useState, useEffect, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconWarning, IconEye, IconCopy, IconDownload, IconLock } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import styles from './WizardOverlay.module.css';

interface CreateStepProps {
  onNext: (account: any, mnemonic: string) => void;
}

export default function CreateStep({ onNext }: CreateStepProps) {
  const [account, setAccount] = useState<any>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [revealed, setRevealed] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [encModalOpen, setEncModalOpen] = useState<boolean>(false);
  const [encPw, setEncPw] = useState<string>('');
  const [encConfirm, setEncConfirm] = useState<string>('');
  const [encError, setEncError] = useState<string>('');
  const [backedUp, setBackedUp] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await rpc<{ account: any; mnemonic: string }>('onboarding_generateAccount');
        setAccount(result.account);
        setMnemonic(result.mnemonic);
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

  const words = mnemonic ? mnemonic.split(' ') : [];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic!);
    setCopied(true);
    setBackedUp(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPlain = () => {
    const blob = new Blob([mnemonic!], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nostr-seed-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setBackedUp(true);
  };

  const handleDownloadEncrypted = async () => {
    setEncError('');
    if (encPw.length < 8) { setEncError(t('wizard.minChars')); return; }
    if (encPw !== encConfirm) { setEncError(t('key.passwordsNoMatch')); return; }
    try {
      const ncryptsec = await rpc<string>('onboarding_exportNcryptsec', { password: encPw });
      if (ncryptsec) {
        const blob = new Blob([ncryptsec], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nostr-backup-${Date.now()}.ncryptsec`;
        a.click();
        URL.revokeObjectURL(url);
        setEncModalOpen(false);
        setBackedUp(true);
      }
    } catch {
      setEncError(t('wizard.failedGenerateBackup'));
    }
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.recoveryTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.recoveryDesc')}
      </p>

      <div className={styles.warningBox}>
        <IconWarning />
        <span>{t('wizard.recoveryWarning')}</span>
      </div>

      <div className={styles.mnemonicWrapper}>
        <div className={`${styles.mnemonicDisplay} ${!revealed ? styles.mnemonicBlurred : ''}`}>
          {words.map((word, i) => (
            <div key={i} className={styles.mnemonicWord}>
              <span className={styles.wordNum}>{i + 1}</span>
              {word}
            </div>
          ))}
        </div>

        {!revealed && (
          <button className={styles.revealBtn} onClick={() => setRevealed(true)}>
            <IconEye size={20} />
            <span>{t('wizard.revealWords')}</span>
          </button>
        )}

        {revealed && (
          <button
            className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
            onClick={handleCopy}
            title={t('common.copy')}
          >
            <IconCopy size={14} />
          </button>
        )}
      </div>

      <div className={styles.backupActions}>
        <button className={styles.backupBtn} onClick={handleDownloadPlain} disabled={!revealed}>
          <IconDownload />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadPlainText')}</strong>
            <span>{t('wizard.saveAsTxt')}</span>
          </div>
        </button>

        <button className={styles.backupBtn} onClick={() => setEncModalOpen(true)} disabled={!revealed}>
          <IconLock />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadEncrypted')}</strong>
            <span>{t('wizard.passwordProtectedFile')}</span>
          </div>
        </button>
      </div>

      <div className={styles.stepActions}>
        <Button onClick={() => onNext(account, mnemonic!)} disabled={!backedUp}>
          {t('wizard.iWrittenItDown')}
        </Button>
      </div>

      {encModalOpen && (
        <div className={styles.encModal}>
          <div className={styles.encCard}>
            <h3>{t('wizard.encryptBackup')}</h3>
            <p>{t('wizard.encryptBackupDesc')}</p>
            <div className={styles.formGroup}>
              <Input
                type="password"
                showToggle
                placeholder={t('key.passwordMinChars')}
                value={encPw}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEncPw(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <Input
                type="password"
                placeholder={t('key.confirmPassword')}
                value={encConfirm}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEncConfirm(e.target.value)}
              />
            </div>
            {encError && <div className={styles.error}>{encError}</div>}
            <div className={styles.stepActions}>
              <Button variant="secondary" small onClick={() => setEncModalOpen(false)}>{t('common.cancel')}</Button>
              <Button small onClick={handleDownloadEncrypted}>{t('common.download')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
