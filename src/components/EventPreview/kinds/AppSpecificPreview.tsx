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

interface AppSpecificPreviewProps {
  event: NostrEvent;
}

export default function AppSpecificPreview({ event }: AppSpecificPreviewProps) {
  const dTag = event.tags?.find((tag) => tag[0] === 'd');
  const app = dTag?.[1] || 'Unknown app';
  const action = dTag?.[2];
  return (
    <>
      <h3 className={styles.sectionTitle}>{t('event.kind')} 30078</h3>
      <FieldDisplay label="App" value={app} />
      {action && <FieldDisplay label="Action" value={action.replace(/_/g, ' ')} />}
    </>
  );
}
