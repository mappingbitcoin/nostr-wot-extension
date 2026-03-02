import React from 'react';
import { truncate } from '@shared/format/text.ts';
import { KIND_LABELS } from '@shared/constants.ts';
import styles from '../EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface GenericPreviewProps {
  event: NostrEvent;
}

export default function GenericPreview({ event }: GenericPreviewProps) {
  const kindLabel = KIND_LABELS[event.kind] || `Kind ${event.kind}`;
  return (
    <>
      <h3 className={styles.sectionTitle}>{kindLabel}</h3>
      {event.content && (
        <div className={styles.noteContent}>{truncate(event.content, 300)}</div>
      )}
    </>
  );
}
