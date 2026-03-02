import React from 'react';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.ts';
import { groupActivityEntries, type ActivityEntry, type GroupedActivity } from '@shared/activity.ts';
import Card from '@components/Card/Card';
import StatusDot from '@components/StatusDot/StatusDot';
import styles from './HomeTab.module.css';

interface HomeActivityProps {
  pending?: ActivityEntry[];
  entries?: ActivityEntry[];
  onViewAll: () => void;
  onSelectGroup?: (group: GroupedActivity) => void;
}

export default function HomeActivity({ pending = [], entries = [], onViewAll, onSelectGroup }: HomeActivityProps) {
  const allEntries = [...pending, ...entries];
  const sorted: GroupedActivity[] = groupActivityEntries(allEntries).slice(0, 5);

  return (
    <Card className={styles.activityCard}>
      <div className={styles.activityHeader}>
        <label>{t('home.recentActivity')}</label>
        <button className={styles.viewAll} onClick={onViewAll}>{t('home.viewAll')}</button>
      </div>
      <div className={styles.activityList}>
        {sorted.length === 0 ? (
          <span className={styles.emptyActivity}>{t('home.noActivityShort')}</span>
        ) : (
          sorted.map((group, i) => (
            <button
              key={i}
              className={styles.activityRow}
              onClick={() => onSelectGroup?.(group)}
            >
              <StatusDot status={group.decision} />
              <span className={styles.activityAction}>{formatLabel(group.methodKey, group.entries?.[0]?.event)}</span>
              {group.count > 1 && (
                <span className={styles.activityCount}>&times;{group.count}</span>
              )}
              <span className={styles.activityTime}>{group.timeKey}</span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}
