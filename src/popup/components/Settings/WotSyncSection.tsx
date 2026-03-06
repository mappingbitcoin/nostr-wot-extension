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
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false);

  const isSyncing = syncState?.inProgress || (syncState?.syncing && syncState?.accountId === item.accountId);

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

  // Poll sync state while syncing
  useEffect(() => {
    if (!isSyncing) return;
    const interval = setInterval(async () => {
      try {
        const [stats, state] = await Promise.all([
          rpc<DatabaseStats | null>('getDatabaseStats', { accountId: item.accountId }),
          rpc<SyncState | null>('getSyncState'),
        ]);
        setDetailStats(stats);
        setSyncState(state);
        if (!state?.inProgress && !state?.syncing) {
          loadStats();
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(interval);
  }, [isSyncing, item.accountId, loadStats]);

  const handleDelete = async () => {
    await rpc('deleteAccountDatabase', { accountId: item.accountId });
    onBack();
  };

  const handleResync = () => {
    rpcNotify('syncGraph', { depth: syncDepth });
    setSyncState({ inProgress: true });
  };

  const getStatusLabel = (): string => {
    if (isSyncing) return t('sync.syncing');
    if (detailStats?.nodes && detailStats.nodes > 0) return t('sync.synced');
    return t('sync.notSynced');
  };

  const getStatusColor = (): string => {
    if (isSyncing) return 'var(--warning)';
    if (detailStats?.nodes && detailStats.nodes > 0) return 'var(--success, #16a34a)';
    return 'var(--text-muted)';
  };

  const depthStats = detailStats?.nodesPerDepth || {};
  const hasData = detailStats?.nodes && detailStats.nodes > 0;

  return (
    <div className={styles.section}>
      {!item.isActive && (
        <div className={styles.inactiveNotice}>
          {t('sync.inactiveDataNotice')}
        </div>
      )}

      {/* Status + last sync */}
      <div className={styles.detailStatus}>
        <span className={styles.detailStatusDot} style={{ background: getStatusColor() }} />
        <span className={styles.detailStatusLabel} style={{ color: getStatusColor() }}>
          {getStatusLabel()}
        </span>
        {isSyncing && <span className={styles.detailSyncSpinner} />}
        <span className={styles.detailLastSync}>
          {detailStats?.lastSync ? formatTimeAgo(detailStats.lastSync) : t('sync.neverSynced')}
        </span>
      </div>

      {/* Stats grid */}
      <div className={styles.statGrid}>
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

      {/* Nodes per depth */}
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

      {/* Sync depth selector */}
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

      {/* Actions */}
      <div className={styles.detailActions}>
        {hasData && !confirmingDelete && (
          <Button variant="danger" small onClick={() => setConfirmingDelete(true)}>
            {t('sync.deleteData')}
          </Button>
        )}
        {confirmingDelete && (
          <div className={styles.confirmDeleteRow}>
            <span className={styles.confirmDeleteMsg}>{t('sync.deleteConfirm')}</span>
            <div className={styles.confirmDeleteBtns}>
              <Button variant="secondary" small onClick={() => setConfirmingDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" small onClick={handleDelete}>
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        )}
        {!confirmingDelete && (
          <Button small onClick={handleResync} disabled={!!isSyncing}>
            {isSyncing ? t('sync.syncing') : t('sync.syncNow')}
          </Button>
        )}
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
  const [loading, setLoading] = useState<boolean>(true);
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

    // Build set of existing DB account IDs
    const dbAccountIds = new Set<string>((dbList || []).map((db: any) => db.accountId || db.name));

    // Merge all accounts from storage and vault
    const accountMap = new Map<string, any>();
    for (const a of allAccounts) accountMap.set(a.id, a);
    for (const a of vAccounts) if (!accountMap.has(a.id)) accountMap.set(a.id, a);

    const items: SyncItem[] = [];

    // Add all known accounts (with or without a DB)
    for (const [accountId, account] of accountMap) {
      const hasDb = dbAccountIds.has(accountId);
      let stats: DatabaseStats | null = null;
      if (hasDb) {
        try { stats = await rpc('getDatabaseStats', { accountId }); } catch { /* ignore */ }
      }

      let displayName = account?.name || truncateNpub(account?.pubkey || accountId);
      try {
        const meta = await rpc<{ name?: string }>('getProfileMetadata', { pubkey: account?.pubkey || accountId });
        if (meta?.name) displayName = meta.name;
      } catch { /* ignore */ }

      items.push({ accountId, displayName, isActive: accountId === activeId, stats, pubkey: account?.pubkey });
    }

    // Also include orphaned DBs (database exists but account was removed)
    for (const db of (dbList || [])) {
      const id = db.accountId || db.name;
      if (!accountMap.has(id)) {
        let stats: DatabaseStats | null = null;
        try { stats = await rpc('getDatabaseStats', { accountId: id }); } catch { /* ignore */ }
        items.push({ accountId: id, displayName: t('sync.accountRemoved'), isActive: false, stats });
      }
    }

    items.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    setDatabases(items);
    setLoading(false);
  }, []);

  useEffect(() => { loadDatabases(); }, [loadDatabases]);

  const getSyncStatus = (item: SyncItem): string => {
    if (syncState?.syncing && syncState?.accountId === item.accountId) return 'syncing';
    if (syncState?.inProgress && item.isActive) return 'syncing';
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
      {loading ? (
        <div className={styles.loadingWrap}>
          <div className={styles.loadingSpinner} />
          <span className={styles.loadingText}>{t('common.loading')}</span>
        </div>
      ) : databases.length === 0 ? (
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
