import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import LocalBlocks from './LocalBlocks';
import MuteLists from './MuteLists';
import styles from './Filters.module.css';

interface FiltersModalProps {
  visible: boolean;
  onClose: () => void;
}

interface Tab {
  id: string;
  label: string;
}

export default function FiltersModal({ visible, onClose }: FiltersModalProps) {
  const [tab, setTab] = useState<string>('blocks');

  const TABS: Tab[] = [
    { id: 'blocks', label: t('filters.localBlocks') },
    { id: 'mutes', label: t('filters.muteLists') },
  ];

  if (!visible) return null;

  return (
    <OverlayPanel title={t('filters.title')} onClose={onClose}>
      <div className={styles.tabs}>
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === 'blocks' && <LocalBlocks />}
        {tab === 'mutes' && <MuteLists />}
      </div>
    </OverlayPanel>
  );
}
