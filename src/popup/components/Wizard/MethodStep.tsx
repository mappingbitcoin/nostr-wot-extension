import React from 'react';
import { t } from '@lib/i18n.js';
import { IconPlus, IconKey, IconEye, IconLink } from '@assets';
import styles from './WizardOverlay.module.css';

const METHOD_ICONS: Record<string, React.ReactNode> = {
  create: <IconPlus />,
  import: <IconKey />,
  npub: <IconEye />,
  nip46: <IconLink />,
};

interface Method {
  id: string;
  label: string;
  desc: string;
  primary?: boolean;
  icon: React.ReactNode;
}

interface MethodStepProps {
  onSelect: (id: string) => void;
}

export default function MethodStep({ onSelect }: MethodStepProps) {
  const METHODS: Method[] = [
    { id: 'create', label: t('wizard.createNew'), desc: t('wizard.createNewDesc'), primary: true, icon: METHOD_ICONS.create },
    { id: 'import', label: t('wizard.importKeyBackup'), desc: t('wizard.importKeyBackupDesc'), icon: METHOD_ICONS.import },
    { id: 'npub', label: t('wizard.watchOnly'), desc: t('wizard.watchOnlyDesc'), icon: METHOD_ICONS.npub },
    { id: 'nip46', label: t('wizard.nostrConnect'), desc: t('wizard.nostrConnectDesc'), icon: METHOD_ICONS.nip46 },
  ];

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.chooseSetup')}</h2>
      <div className={styles.methodGrid}>
        {METHODS.map((m, i) => (
          <React.Fragment key={m.id}>
            {i === 1 && (
              <div className={styles.methodDivider}>
                <div className={styles.methodDividerLine} />
                <span className={styles.methodDividerText}>{t('common.or')}</span>
                <div className={styles.methodDividerLine} />
              </div>
            )}
            <button
              className={`${styles.methodCard} ${m.primary ? styles.methodPrimary : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <div className={styles.methodIcon}>{m.icon}</div>
              <div className={styles.methodInfo}>
                <strong>{m.label}</strong>
                <span>{m.desc}</span>
              </div>
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
