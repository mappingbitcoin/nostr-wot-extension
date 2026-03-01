import React, { useState, useEffect, useCallback } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { truncateNpub } from '@shared/format/text.ts';
import { formatTimeAgo } from '@shared/format/time.ts';
import { formatBytes } from '@shared/format/bytes.ts';
import { IconChevronRight, IconSync } from '@assets';
import Button from '@components/Button/Button';
import Toggle from '@components/Toggle/Toggle';
import Card from '@components/Card/Card';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

const SYNC_DEPTHS = [2, 3, 4];

interface DatabaseStats {
  nodes?: number;
  edges?: number;
  dbSizeBytes?: number;
  syncDepth?: number;
  lastSync?: number;
  nodesPerDepth?: Record<string, number>;
}

interface SyncState {
  inProgress?: boolean;
  syncing?: boolean;
  accountId?: string;
}

interface SyncItem {
  accountId: string;
  displayName: string;
  isActive: boolean;
  stats: DatabaseStats | null;
  pubkey?: string;
}

/* -- Detail sub-view for a single account -- */
interface WotSyncDetailProps {
  item: SyncItem;
  onBack: () => void;
}

export function WotSyncDetail({ item, onBack }: WotSyncDetailProps) {
  const [detailStats, setDetailStats] = useState<DatabaseStats | null>(null);
  const [syncDepth, setSyncDepth] = useState<number>(3);
  const [syncState, setSyncState] = useState<SyncState | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const [stats, state] = await Promise.all([
        rpc<DatabaseStats | null>('getDatabaseStats', { accountId: item.accountId }),
        rpc<SyncState | null>('getSyncState'),
      ]);
      setDetailStats(stats);
      setSyncState(state);
      if (stats?.syncDepth) setSyncDepth(stats.syncDepth);
    } catch {
      setDetailStats(null);
    }
  }, [item.accountId]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleDelete = async () => {
    await rpc('deleteAccountDatabase', { accountId: item.accountId });
    onBack();
  };

  const handleResync = () => {
    rpcNotify('syncGraph', { depth: syncDepth });
  };

  const isSyncing = syncState?.inProgress || (syncState?.syncing && syncState?.accountId === item.accountId);

  const getStatusLabel = (): string => {
    if (isSyncing) return t('sync.syncing');
    if (detailStats?.nodes && detailStats.nodes > 0) return t('sync.synced');
    return t('sync.notSynced');
  };

  const depthStats = detailStats?.nodesPerDepth || {};

  return (
    <div className={styles.section}>
      {!item.isActive && (
        <div className={styles.inactiveNotice}>
          {t('sync.inactiveDataNotice')}
        </div>
      )}

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{getStatusLabel()}</div>
          <div className={styles.statLabel}>{t('sync.status')}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{detailStats?.nodes?.toLocaleString() || '0'}</div>
          <div className={styles.statLabel}>{t('sync.nodes')}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{detailStats?.edges?.toLocaleString() || '0'}</div>
          <div className={styles.statLabel}>{t('sync.edges')}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{formatBytes(detailStats?.dbSizeBytes || 0)}</div>
          <div className={styles.statLabel}>{t('sync.size')}</div>
        </div>
      </div>

      {Object.keys(depthStats).length > 0 && (
        <>
          <SectionLabel>{t('sync.nodesPerDepth')}</SectionLabel>
          <div className={styles.depthBreakdown}>
            {Object.entries(depthStats).map(([depth, count]) => (
              <span key={depth} className={styles.depthChip}>
                {t('sync.hop', { n: depth })}: {(count as number).toLocaleString()}
              </span>
            ))}
          </div>
        </>
      )}

      <SectionLabel>{t('sync.syncDepth')}</SectionLabel>
      <div className={styles.modeRow}>
        {SYNC_DEPTHS.map((d) => (
          <button
            key={d}
            className={`${styles.modeBtn} ${d === syncDepth ? styles.modeBtnActive : ''}`}
            onClick={() => setSyncDepth(d)}
          >
            <span className={styles.modeBtnLabel}>{t('sync.hopLabel', { n: d })}</span>
          </button>
        ))}
      </div>
      {syncDepth >= 4 && (
        <div className={styles.inactiveNotice}>
          {t('sync.depthWarning4')}
        </div>
      )}

      <div className={styles.detailActions}>
        {detailStats?.nodes && detailStats.nodes > 0 && (
          <Button variant="danger" small onClick={handleDelete}>{t('sync.deleteData')}</Button>
        )}
        <Button small onClick={handleResync} disabled={!!isSyncing}>
          {isSyncing ? t('sync.syncing') : t('sync.syncNow')}
        </Button>
      </div>
    </div>
  );
}

/* -- List view (databases) -- */
interface WotSyncSectionProps {
  onOpenDetail: (item: SyncItem) => void;
}

export default function WotSyncSection({ onOpenDetail }: WotSyncSectionProps) {
  const [databases, setDatabases] = useState<SyncItem[]>([]);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [autoSync, setAutoSync] = useState<boolean>(false);

  const loadDatabases = useCallback(async () => {
    const [dbList, accounts, vaultAccounts, activeData, state, syncSettings] = await Promise.all([
      rpc<any[]>('listDatabases'),
      browser.storage.local.get(['accounts']) as Promise<any>,
      rpc<any[]>('vault_listAccounts'),
      browser.storage.local.get(['activeAccountId']) as Promise<any>,
      rpc<SyncState | null>('getSyncState'),
      browser.storage.sync.get(['autoSyncOnFollowChange']) as Promise<any>,
    ]);

    setSyncState(state);
    setAutoSync(!!syncSettings.autoSyncOnFollowChange);
    const activeId = activeData.activeAccountId;
    const allAccounts: any[] = accounts.accounts || [];
    const vAccounts: any[] = vaultAccounts || [];

    const items: SyncItem[] = [];
    const dbs: any[] = dbList || [];

    for (const db of dbs) {
      const accountId = db.accountId || db.name;
      const account = allAccounts.find((a) => a.id === accountId) || vAccounts.find((a) => a.id === accountId);
      const isActive = accountId === activeId;

      let stats: DatabaseStats | null = null;
      try {
        stats = await rpc('getDatabaseStats', { accountId });
      } catch { /* ignore */ }

      let displayName = account?.name || truncateNpub(account?.pubkey || accountId);
      try {
        const meta = await rpc<{ name?: string }>('getProfileMetadata', { pubkey: account?.pubkey || accountId });
        if (meta?.name) displayName = meta.name;
      } catch { /* ignore */ }

      items.push({ accountId, displayName, isActive, stats, pubkey: account?.pubkey });
    }

    items.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    setDatabases(items);
  }, []);

  useEffect(() => { loadDatabases(); }, [loadDatabases]);

  const getSyncStatus = (item: SyncItem): string => {
    if (syncState?.syncing && syncState?.accountId === item.accountId) return 'syncing';
    if (item.stats?.nodes && item.stats.nodes > 0) return 'synced';
    return 'not-synced';
  };

  const getSyncLabel = (status: string): string => {
    if (status === 'syncing') return t('sync.syncing');
    if (status === 'synced') return t('sync.synced');
    return t('sync.notSynced');
  };

  const getStatusColor = (status: string): string => {
    if (status === 'synced') return 'var(--success, #16a34a)';
    if (status === 'syncing') return 'var(--warning)';
    return 'var(--text-muted)';
  };

  const handleAutoSyncToggle = (val: boolean) => {
    setAutoSync(val);
    browser.storage.sync.set({ autoSyncOnFollowChange: val });
  };

  return (
    <div className={styles.section}>
      <div className={styles.accountScope}>
        <Card className={styles.accountScopeCard}>
          <div className={styles.controlRow}>
            <div className={styles.controlInfo}>
              <IconSync size={15} className={styles.controlIcon} />
              <div>
                <span className={styles.controlLabel}>{t('sync.autoSyncFollows')}</span>
                <div className={styles.controlHint}>{t('sync.autoSyncFollowsHint')}</div>
              </div>
            </div>
            <Toggle checked={autoSync} onChange={handleAutoSyncToggle} />
          </div>
        </Card>
      </div>
      {databases.length === 0 ? (
        <EmptyState text={t('sync.noDatabases')} hint={t('sync.noDatabasesHint')} />
      ) : (
        <>
        <SectionLabel>{t('sync.wotDatabases')}</SectionLabel>
        <div className={styles.dbList}>
          {databases.map((item) => {
            const status = getSyncStatus(item);
            return (
              <button key={item.accountId} className={styles.dbRow} onClick={() => onOpenDetail(item)}>
                <div className={styles.dbInfo}>
                  <div className={styles.dbName}>
                    {item.displayName}
                    {item.pubkey && (
                      <span className={styles.dbNpub}> ({truncateNpub(item.pubkey)})</span>
                    )}
                  </div>
                  <div className={styles.dbStatus}>
                    <span style={{ color: getStatusColor(status) }}>{getSyncLabel(status)}</span>
                    {item.stats?.lastSync && ` \u00b7 ${formatTimeAgo(item.stats.lastSync)}`}
                  </div>
                </div>
                {item.isActive && <span className={styles.activeBadge}>{t('sync.active')}</span>}
                <IconChevronRight className={styles.chevron} />
              </button>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
