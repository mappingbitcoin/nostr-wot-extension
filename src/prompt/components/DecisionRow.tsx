import React, { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import Select from '@components/Select/Select';
import styles from '../PromptApp.module.css';

interface PromptDecision {
  allow: boolean;
  remember: boolean;
  duration?: number;
}

interface DecisionRowProps {
  disabled: boolean;
  onDecision: (decision: PromptDecision) => void;
}

export default function DecisionRow({ disabled, onDecision }: DecisionRowProps) {
  const [duration, setDuration] = useState<string>('3600000'); // 1 hour default

  return (
    <div className={styles.decisionRow}>
      <button
        className={`${styles.decisionBtn} ${styles.deny}`}
        disabled={disabled}
        onClick={() => onDecision({ allow: false, remember: false })}
      >
        {t('prompt.deny')}
      </button>
      <button
        className={`${styles.decisionBtn} ${styles.allowOnce}`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: false })}
      >
        {t('prompt.once')}
      </button>
      <button
        className={`${styles.decisionBtn} ${styles.allowSession}`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: true, duration: parseInt(duration) })}
      >
        {t('prompt.session')}
      </button>
      <Select
        small
        className={styles.durationSelect}
        options={[
          { value: '3600000', label: t('prompt.1h') },
          { value: '86400000', label: t('prompt.24h') },
          { value: '604800000', label: t('prompt.7d') },
          { value: '0', label: t('prompt.forever') },
        ]}
        value={duration}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => setDuration(e.target.value)}
      />
      <button
        className={`${styles.decisionBtn} ${styles.always}`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: true, duration: 0 })}
      >
        {t('prompt.always')}
      </button>
    </div>
  );
}
