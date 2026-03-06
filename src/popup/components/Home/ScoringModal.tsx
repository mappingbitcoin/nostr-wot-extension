import React, { useState, useCallback, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@lib/i18n.js';
import { DEFAULT_SCORING } from '@lib/scoring.js';
import { SENSITIVITY_PRESETS } from '@shared/constants.ts';
import { toPercent, toFraction } from '@shared/format/number.js';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { IconInfo } from '@assets';
import { useScoring } from '../../context/ScoringContext';
import homeStyles from './HomeTab.module.css';
import styles from './ScoringModal.module.css';

interface ScoringModalProps {
  onClose: () => void;
}

interface Weights {
  w2: number | string;
  w3: number | string;
  w4: number | string;
}

interface PathBonus {
  pb2: number | string;
  pb3: number | string;
  pb4: number | string;
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className={styles.infoTip}>
      <IconInfo size={13} />
      <span className={styles.infoTipText}>{text}</span>
    </span>
  );
}

export default function ScoringModal({ onClose }: ScoringModalProps) {
  const { scoring, presetIndex, presetDesc, setPreset, saveCustom, reset } = useScoring();

  const [weights, setWeights] = useState<Weights>(() => {
    const w = scoring.distanceWeights || DEFAULT_SCORING.distanceWeights;
    return { w2: toPercent(w[2], 0.5), w3: toPercent(w[3], 0.25), w4: toPercent(w[4], 0.1) };
  });
  const [pathBonus, setPathBonus] = useState<PathBonus>(() => {
    const pb = scoring.pathBonus || DEFAULT_SCORING.pathBonus;
    if (typeof pb === 'object') {
      return { pb2: toPercent(pb[2], 0.15), pb3: toPercent(pb[3], 0.1), pb4: toPercent(pb[4], 0.05) };
    }
    const pct = toPercent(pb, 0.1);
    return { pb2: pct, pb3: pct, pb4: pct };
  });
  const [maxPB, setMaxPB] = useState<number | string>(() => toPercent(scoring.maxPathBonus ?? DEFAULT_SCORING.maxPathBonus, 0.5));

  const detectPresetMatch = useCallback((w: Weights, pb: PathBonus) => {
    const w2 = parseFloat(String(w.w2)) / 100;
    const w3 = parseFloat(String(w.w3)) / 100;
    const pb2 = parseFloat(String(pb.pb2)) / 100;
    for (let i = 0; i < SENSITIVITY_PRESETS.length; i++) {
      const p = SENSITIVITY_PRESETS[i];
      if (
        Math.abs(p.weights[2] - w2) < 0.01 &&
        Math.abs(p.weights[3] - w3) < 0.01 &&
        Math.abs(p.pathBonus[2] - pb2) < 0.01
      ) {
        return i;
      }
    }
    return -1;
  }, []);

  const currentMatch = detectPresetMatch(weights, pathBonus);
  const isCustom = currentMatch === -1;
  const displayDesc = isCustom ? t('scoring.custom') : presetDesc;

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    setPreset(idx);
    const p = SENSITIVITY_PRESETS[idx];
    setWeights({
      w2: Math.round(p.weights[2] * 100),
      w3: Math.round(p.weights[3] * 100),
      w4: Math.round((p.weights[4] ?? 0.1) * 100),
    });
    setPathBonus({
      pb2: Math.round(p.pathBonus[2] * 100),
      pb3: Math.round(p.pathBonus[3] * 100),
      pb4: Math.round((p.pathBonus[4] ?? 0.05) * 100),
    });
    setMaxPB(Math.round(p.maxPathBonus * 100));
  };

  const handleSave = () => {
    saveCustom({
      distanceWeights: {
        1: 1.0,
        2: toFraction(weights.w2, 0.5),
        3: toFraction(weights.w3, 0.25),
        4: toFraction(weights.w4, 0.1),
      },
      pathBonus: {
        2: toFraction(pathBonus.pb2, 0.15),
        3: toFraction(pathBonus.pb3, 0.1),
        4: toFraction(pathBonus.pb4, 0.05),
      },
      maxPathBonus: toFraction(maxPB, 0.5),
    });
  };

  const handleReset = () => {
    setWeights({ w2: 50, w3: 25, w4: 10 });
    setPathBonus({ pb2: 15, pb3: 10, pb4: 5 });
    setMaxPB(50);
    reset();
  };

  const panel = (
    <OverlayPanel title={t('scoring.trustSensitivity')} onClose={onClose} onBack={null}>
      <div className={homeStyles.sensitivitySlider}>
        <input type="range" min="0" max="4" step="1" value={isCustom ? presetIndex : currentMatch} onChange={handleSliderChange} />
        <div className={homeStyles.sensitivityLabels}>
          <span>{t('scoring.strict')}</span>
          <span>{t('scoring.open')}</span>
        </div>
      </div>
      <p className={styles.presetDesc}>{displayDesc}</p>

      <div className={styles.section}>
        <SectionLabel>
          {t('scoring.baseScore')}
          <InfoTip text={t('scoring.baseScoreInfo')} />
        </SectionLabel>
        <div className={styles.inputGrid}>
          <Input small center label={t('scoring.hops2')} type="number" min={0} max={100} step={5} value={weights.w2} onChange={(e: ChangeEvent<HTMLInputElement>) => setWeights((w) => ({ ...w, w2: e.target.value }))} />
          <Input small center label={t('scoring.hops3')} type="number" min={0} max={100} step={5} value={weights.w3} onChange={(e: ChangeEvent<HTMLInputElement>) => setWeights((w) => ({ ...w, w3: e.target.value }))} />
          <Input small center label={t('scoring.hops4')} type="number" min={0} max={100} step={5} value={weights.w4} onChange={(e: ChangeEvent<HTMLInputElement>) => setWeights((w) => ({ ...w, w4: e.target.value }))} />
        </div>
      </div>

      <div className={styles.section}>
        <SectionLabel>
          {t('scoring.pathBonus')}
          <InfoTip text={t('scoring.pathBonusInfo')} />
        </SectionLabel>
        <div className={styles.inputGrid}>
          <Input small center label={t('scoring.hops2')} type="number" min={0} max={100} step={1} value={pathBonus.pb2} onChange={(e: ChangeEvent<HTMLInputElement>) => setPathBonus((p) => ({ ...p, pb2: e.target.value }))} />
          <Input small center label={t('scoring.hops3')} type="number" min={0} max={100} step={1} value={pathBonus.pb3} onChange={(e: ChangeEvent<HTMLInputElement>) => setPathBonus((p) => ({ ...p, pb3: e.target.value }))} />
          <Input small center label={t('scoring.hops4')} type="number" min={0} max={100} step={1} value={pathBonus.pb4} onChange={(e: ChangeEvent<HTMLInputElement>) => setPathBonus((p) => ({ ...p, pb4: e.target.value }))} />
        </div>
      </div>

      <div className={styles.section}>
        <SectionLabel>
          {t('scoring.maxPathBonus')}
          <InfoTip text={t('scoring.maxPathBonusInfo')} />
        </SectionLabel>
        <Input small center type="number" min={0} max={200} step={5} value={maxPB} onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxPB(e.target.value)} />
      </div>

      <div className={styles.footer}>
        <Button variant="secondary" small onClick={handleReset}>{t('scoring.resetDefaults')}</Button>
        <Button small onClick={handleSave}>{t('common.save')}</Button>
      </div>
    </OverlayPanel>
  );

  return createPortal(panel, document.getElementById('root') || document.body);
}
