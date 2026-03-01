import React from 'react';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.js';
import { IconChevronRight, IconSync } from '@assets';
import styles from './ApprovalOverlay.module.css';

interface ApprovalRequest {
  permKey?: string;
  event?: any;
  [key: string]: any;
}

interface ApprovalGroup {
  origin: string;
  method: string;
  nip46InFlight?: boolean;
  requests: ApprovalRequest[];
}

interface ApprovalCardProps {
  group: ApprovalGroup;
  onClick: () => void;
}

export default function ApprovalCard({ group, onClick }: ApprovalCardProps) {
  const domain = group.origin;
  const firstReq = group.requests[0];
  const label = formatLabel(firstReq?.permKey || group.method, firstReq?.event);
  const isNip46 = group.nip46InFlight;

  return (
    <button
      className={`${styles.card} ${isNip46 ? styles.cardNip46 : ''}`}
      onClick={onClick}
    >
      <div className={styles.cardLeft}>
        <div className={styles.cardOrigin}>{domain}</div>
        <div className={styles.cardMethod}>
          {isNip46 && <IconSync size={12} className={styles.spinnerIcon} />}
          {isNip46 ? t('approval.awaitingSigner') : label}
        </div>
        {!isNip46 && group.requests.length > 1 && (
          <div className={styles.cardCount}>{t('approval.requests', { count: group.requests.length })}</div>
        )}
      </div>
      {isNip46 ? null : <IconChevronRight size={16} className={styles.cardChevron} />}
    </button>
  );
}
