import React from 'react';
import { t } from '@lib/i18n.js';
import { useScoring } from '../../context/ScoringContext';
import styles from './Filters.module.css';

const STRATEGY_IDS = ['strict', 'conservative', 'balanced', 'open', 'very-open'];

interface StrategyItem {
  id: string;
  label: string;
  desc: string;
}

export default function Strategies() {
  const { presetIndex, setPreset } = useScoring();

  const STRATEGY_ITEMS: StrategyItem[] = [
    { id: 'strict', label: t('scoring.strict'), desc: t('scoring.strictDesc') },
    { id: 'conservative', label: t('scoring.conservative'), desc: t('scoring.conservativeDesc') },
    { id: 'balanced', label: t('scoring.balanced'), desc: t('scoring.balancedDesc') },
    { id: 'open', label: t('scoring.open'), desc: t('scoring.openDesc') },
    { id: 'very-open', label: t('scoring.veryOpen'), desc: t('scoring.veryOpenDesc') },
  ];

  const active = STRATEGY_IDS[presetIndex] || 'balanced';

  const handleSelect = (id: string) => {
    const idx = STRATEGY_IDS.indexOf(id);
    if (idx >= 0) setPreset(idx);
  };

  return (
    <>
      {STRATEGY_ITEMS.map((s) => (
        <button
          key={s.id}
          className={`${styles.strategyCard} ${active === s.id ? styles.strategyCardActive : ''}`}
          onClick={() => handleSelect(s.id)}
        >
          <div className={`${styles.strategyRadio} ${active === s.id ? styles.strategyRadioActive : ''}`} />
          <div className={styles.strategyContent}>
            <div className={styles.strategyLabel}>{s.label}</div>
            <div className={styles.strategyDesc}>{s.desc}</div>
          </div>
        </button>
      ))}
    </>
  );
}
