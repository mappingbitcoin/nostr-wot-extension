import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

interface DoneAccount {
  name?: string;
  type: string;
  pubkey?: string;
}

interface DoneStepProps {
  account: DoneAccount | null;
  onDone: () => void;
}

export default function DoneStep({ account, onDone }: DoneStepProps) {
  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.yourAllSet')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.identityReady')}
      </p>

      {account && (
        <div className={styles.summaryCard}>
          {account.name && (
            <div className={styles.summaryField}>
              <label>{t('wizard.nameLabel')}</label>
              <span>{account.name}</span>
            </div>
          )}
          <div className={styles.summaryField}>
            <label>{t('wizard.typeLabel')}</label>
            <span>{t(`wizard.type.${account.type}`)}</span>
          </div>
          <div className={styles.summaryField}>
            <label>{t('wizard.publicKeyLabel')}</label>
            <span>{account.pubkey?.slice(0, 12)}...{account.pubkey?.slice(-12)}</span>
          </div>
        </div>
      )}

      <div className={styles.stepActions}>
        <Button onClick={onDone}>{t('wizard.getStarted')}</Button>
      </div>
    </div>
  );
}
