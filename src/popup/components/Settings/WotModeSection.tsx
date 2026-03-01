import React from 'react';
import { rpcNotify } from '@shared/rpc.ts';
import useBrowserStorage from '@shared/hooks/useBrowserStorage.ts';
import { t } from '@lib/i18n.js';
import { IconSync, IconLayers, IconDatabase, IconCloud, IconMerge } from '@assets';
import NavItem from '@components/NavItem/NavItem';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

interface ModeOption {
  id: string;
  icon: React.ComponentType<any>;
}

const MODES: ModeOption[] = [
  { id: 'local', icon: IconDatabase },
  { id: 'remote', icon: IconCloud },
  { id: 'hybrid', icon: IconMerge },
];

interface WotModeSectionProps {
  onSync: () => void;
  onBadges: () => void;
}

export default function WotModeSection({ onSync, onBadges }: WotModeSectionProps) {
  const [mode, setMode] = useBrowserStorage('mode', 'remote');

  const handleModeChange = (id: string) => {
    setMode(id);
    rpcNotify('configUpdated');
  };

  return (
    <div className={styles.section}>
      <SectionLabel>{t('wot.modeLabel')}</SectionLabel>

      <div className={styles.modeRow}>
        {MODES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.modeBtn} ${mode === id ? styles.modeBtnActive : ''}`}
            onClick={() => handleModeChange(id)}
          >
            <Icon size={20} className={styles.modeBtnIcon} />
            <span className={styles.modeBtnLabel}>{t('wot.' + id)}</span>
          </button>
        ))}
      </div>

      {mode && (
        <div className={styles.modeDesc}>{t('wot.' + mode + 'Desc')}</div>
      )}

      <div className={styles.separator} />

      <NavItem
        icon={<IconSync />}
        label={t('wot.syncDatabases')}
        desc={t('wot.syncDatabasesDesc')}
        onClick={onSync}
      />

      <NavItem
        icon={<IconLayers />}
        label={t('wot.badgeInjection')}
        desc={t('wot.badgeInjectionDesc')}
        onClick={onBadges}
      />
    </div>
  );
}
