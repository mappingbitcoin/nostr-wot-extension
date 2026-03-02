import React, { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { IconTuner } from '@assets';
import { useScoring } from '../../context/ScoringContext';
import ScoringModal from './ScoringModal';
import styles from './HomeTab.module.css';

export default function ScoringCard() {
  const { presetIndex, presetDesc, setPreset } = useScoring();
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    setPreset(parseInt(e.target.value));
  };

  return (
    <>
      <div className={styles.scoringContent}>
        <div className={styles.scoringHeader}>
          <label>{t('scoring.trustSensitivity')}</label>
          <button
            className={styles.tunerBtn}
            title={t('scoring.advancedScoring')}
            onClick={() => setModalOpen(true)}
          >
            <IconTuner size={15} />
          </button>
        </div>
        <div className={styles.sensitivitySlider}>
          <input type="range" min="0" max="4" step="1" value={presetIndex} onChange={handleSliderChange} />
          <div className={styles.sensitivityLabels}>
            <span>{t('scoring.strict')}</span>
            <span>{t('scoring.open')}</span>
          </div>
        </div>
        <p className={styles.sensitivityDesc}>{presetDesc}</p>
      </div>

      {modalOpen && (
        <ScoringModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
