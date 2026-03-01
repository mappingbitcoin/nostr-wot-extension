import React from 'react';
import { t } from '@lib/i18n.js';
import styles from '../EventPreview.module.css';

export default function RepostPreview() {
  return (
    <>
      <h3 className={styles.sectionTitle}>{t('event.repost')}</h3>
      <div className={styles.eventNote}>{t('event.repostingNote')}</div>
    </>
  );
}
