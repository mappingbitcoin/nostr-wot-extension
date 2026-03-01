import { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconCopy, IconDownload, IconLock, IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import styles from './WizardOverlay.module.css';

interface BackupStepProps {
  mnemonic: string | null;
  onNext: () => void;
}

export default function BackupStep({ mnemonic, onNext }: BackupStepProps) {
  const [safetyShown, setSafetyShown] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [encModalOpen, setEncModalOpen] = useState<boolean>(false);
  const [encPw, setEncPw] = useState<string>('');
  const [encConfirm, setEncConfirm] = useState<string>('');
  const [encError, setEncError] = useState<string>('');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(mnemonic!);
    setCopied(true);
    setSafetyShown(true);
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
    setSafetyShown(true);
  };

  const handleDownloadEncrypted = async () => {
    setEncError('');
    if (encPw.length < 8) { setEncError(t('wizard.minChars')); return; }
    if (encPw !== encConfirm) { setEncError(t('key.passwordsNoMatch')); return; }
    try {
      const ncryptsec = await rpc<string>('vault_exportNcryptsec', { password: encPw });
      if (ncryptsec) {
        const blob = new Blob([ncryptsec], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nostr-backup-${Date.now()}.ncryptsec`;
        a.click();
        URL.revokeObjectURL(url);
        setEncModalOpen(false);
        setSafetyShown(true);
      }
    } catch {
      setEncError(t('wizard.failedGenerateBackup'));
    }
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.backUpKeys')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.chooseBackup')}
      </p>

      <div className={styles.backupActions}>
        <button className={styles.backupBtn} onClick={handleCopy}>
          <IconCopy />
          <div className={styles.backupBtnText}>
            <strong>{copied ? t('common.copied') : t('wizard.copySeed')}</strong>
            <span>{t('wizard.pasteIntoManager')}</span>
          </div>
        </button>

        <button className={styles.backupBtn} onClick={handleDownloadPlain}>
          <IconDownload />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadPlainText')}</strong>
            <span>{t('wizard.saveAsTxt')}</span>
          </div>
        </button>

        <button className={styles.backupBtn} onClick={() => setEncModalOpen(true)}>
          <IconLock />
          <div className={styles.backupBtnText}>
            <strong>{t('wizard.downloadEncrypted')}</strong>
            <span>{t('wizard.passwordProtectedFile')}</span>
          </div>
        </button>
      </div>

      {safetyShown && (
        <div className={styles.safetyDrawer}>
          <IconWarning size={20} className={styles.safetyIcon} />
          <h3>{t('wizard.keepSafe')}</h3>
          <p>
            {t('wizard.keepSafeDesc')}
          </p>
          <Button small onClick={onNext}>{t('wizard.gotItVerify')}</Button>
        </div>
      )}

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
