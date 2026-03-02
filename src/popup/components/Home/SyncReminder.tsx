import React from 'react';
import { t } from '@lib/i18n.js';
import { formatTimeAgo } from '@shared/format/time.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import { IconUsers } from '@assets';
import styles from './HomeTab.module.css';

interface SyncReminderProps {
  lastSync?: number | null;
  syncing?: boolean;
  onSync?: () => void;
  onDismiss: () => void;
}

export default function SyncReminder({ lastSync, syncing, onSync, onDismiss }: SyncReminderProps) {
  if (syncing) {
    return (
      <Card className={`${styles.syncReminder} ${styles.syncReminderSyncing}`}>
        <div className={styles.syncReminderContent}>
          <span className={styles.syncSpinner} />
          <div className={styles.syncReminderText}>
            <strong>{t('sync.inProgress')}</strong>
          </div>
        </div>
        <div className={styles.syncReminderActions}>
          <button className={styles.dismissBtn} onClick={onDismiss}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className={styles.syncReminder}>
      <div className={styles.syncReminderContent}>
        <IconUsers size={20} className={styles.syncReminderIcon} />
        <div className={styles.syncReminderText}>
          <strong>{t('home.syncOutdated')}</strong>
          <span>
            {lastSync
              ? t('home.lastSynced', { time: formatTimeAgo(lastSync) })
              : t('home.neverSynced')}
          </span>
        </div>
      </div>
      <div className={styles.syncReminderActions}>
        <Button small onClick={onSync}>{t('sync.syncNow')}</Button>
        <button className={styles.dismissBtn} onClick={onDismiss}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </Card>
  );
}
