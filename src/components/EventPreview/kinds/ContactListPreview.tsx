import React from 'react';
import { t } from '@lib/i18n.js';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import styles from '../EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface FollowDiff {
  added: string[];
  removed: string[];
  unchangedCount: number;
}

interface ContactListPreviewProps {
  event: NostrEvent;
  followDiff?: FollowDiff | null;
}

export default function ContactListPreview({ event, followDiff }: ContactListPreviewProps) {
  const count = event.tags?.filter((tag) => tag[0] === 'p').length || 0;
  return (
    <>
      <h3 className={styles.sectionTitle}>{t('event.contactList')}</h3>
      <FieldDisplay label={t('event.contacts')} value={t('event.nEntries', { count })} />
      {followDiff && (
        <div className={styles.followDiff}>
          {followDiff.added.length > 0 && (
            <span className={styles.diffAdded}>+{followDiff.added.length} {t('event.followsAdded')}</span>
          )}
          {followDiff.removed.length > 0 && (
            <span className={styles.diffRemoved}>-{followDiff.removed.length} {t('event.followsRemoved')}</span>
          )}
          {followDiff.unchangedCount > 0 && (
            <span className={styles.diffUnchanged}>{followDiff.unchangedCount} {t('event.followsUnchanged')}</span>
          )}
        </div>
      )}
    </>
  );
}
