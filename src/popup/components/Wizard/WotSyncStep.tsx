import React, { useState } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconUsers } from '@assets';
import Button from '@components/Button/Button';
import Toggle from '@components/Toggle/Toggle';
import styles from './WizardOverlay.module.css';

const DEPTHS = [2, 3, 4];

interface WotSyncStepProps {
  onNext: () => void;
}

export default function WotSyncStep({ onNext }: WotSyncStepProps) {
  const [depth, setDepth] = useState<number>(3);
  const [autoSync, setAutoSync] = useState<boolean>(true);

  const handleAutoSyncToggle = (val: boolean) => {
    setAutoSync(val);
    browser.storage.sync.set({ autoSyncOnFollowChange: val });
  };

  const handleSync = async () => {
    browser.storage.sync.set({ autoSyncOnFollowChange: autoSync });
    rpcNotify('syncGraph', { depth });
    onNext();
  };

  const handleSkip = () => {
    browser.storage.sync.set({ autoSyncOnFollowChange: autoSync });
    onNext();
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.wotTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.wotDesc')}
      </p>

      <div className={styles.wotSyncInfo}>
        <IconUsers size={32} stroke="var(--brand)" />
        <div className={styles.depthPicker}>
          {DEPTHS.map((d) => (
            <button
              key={d}
              className={`${styles.depthBtn} ${d === depth ? styles.depthBtnActive : ''}`}
              onClick={() => setDepth(d)}
            >
              {t('wizard.hopCount', { n: d })}
            </button>
          ))}
        </div>
        <div className={styles.wotSyncStat}>
          {t(`wizard.hopDesc${depth}`)}
        </div>
        {depth >= 4 && (
          <div className={styles.hopWarning}>
            {t('wizard.hopSpamWarning')}
          </div>
        )}
      </div>

      <div className={styles.autoSyncRow}>
        <div className={styles.autoSyncLabel}>
          <span>{t('sync.autoSyncFollows')}</span>
          <span className={styles.autoSyncHint}>{t('sync.autoSyncFollowsHint')}</span>
        </div>
        <Toggle checked={autoSync} onChange={handleAutoSyncToggle} />
      </div>

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={handleSkip}>{t('wizard.skipForNow')}</Button>
        <Button onClick={handleSync}>{t('wizard.syncNow')}</Button>
      </div>
    </div>
  );
}
