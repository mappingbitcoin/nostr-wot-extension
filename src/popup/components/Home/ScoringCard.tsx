import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronRight } from '@assets';
import ScoringModal from './ScoringModal';
import styles from './HomeTab.module.css';

export default function ScoringCard() {
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  return (
    <>
      <button className={styles.controlLink} onClick={() => setModalOpen(true)}>
        <span>{t('scoring.trustSensitivity')}</span>
        <IconChevronRight size={14} />
      </button>

      {modalOpen && (
        <ScoringModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
