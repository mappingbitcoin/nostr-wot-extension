import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

interface ScoringCardProps {
  onOpen?: () => void;
}

export default function ScoringCard({ onOpen }: ScoringCardProps) {
  return (
    <button className={styles.controlLink} onClick={onOpen}>
      <span>{t('scoring.trustSensitivity')}</span>
      <IconChevronRight size={14} />
    </button>
  );
}
