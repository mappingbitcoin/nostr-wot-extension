import React, { useState, useEffect, useCallback, useRef, useMemo, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { formatLabel } from '@shared/permissions.js';
import { groupActivityEntries, type ActivityEntry, type GroupedActivity } from '@shared/activity.js';
import { truncateNpub } from '@shared/format/text.js';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import Input from '@components/Input/Input';
import StatusDot from '@components/StatusDot/StatusDot';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import { IconTuner } from '@assets';
import { useAccount } from '../../context/AccountContext';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import styles from './ActivityModal.module.css';

// Maps grouped type filter values to the actual method names
const TYPE_METHODS: Record<string, string[]> = {
  signEvent: ['signEvent'],
  getPublicKey: ['getPublicKey'],
  encrypt: ['nip04Encrypt', 'nip44Encrypt'],
  decrypt: ['nip04Decrypt', 'nip44Decrypt'],
  nip04Encrypt: ['nip04Encrypt'],
  nip04Decrypt: ['nip04Decrypt'],
  nip44Encrypt: ['nip44Encrypt'],
  nip44Decrypt: ['nip44Decrypt'],
};

interface ActivityModalProps {
  visible: boolean;
  initialDomain: string | null;
  initialPubkey: string;
  onClose: () => void;
}

interface DropdownOption {
  value: string;
  label: string;
}

export default function ActivityModal({ visible, initialDomain, initialPubkey, onClose }: ActivityModalProps) {
  const rawLog = useRef<ActivityEntry[]>([]);
  const [logVersion, setLogVersion] = useState<number>(0);
  const [filter, setFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pubkeyFilter, setPubkeyFilter] = useState<string>('');
  const [advancedTypes, setAdvancedTypes] = useState<boolean>(false);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupedActivity | null>(null);
  const { accounts, profileCache } = useAccount();

  // Sync filters when modal opens
  useEffect(() => {
    if (visible) {
      setFilter(initialDomain || '');
      setAccountFilter(initialPubkey || '');
      setTypeFilter('');
      setPubkeyFilter('');
      setAdvancedTypes(false);
      setFiltersOpen(false);
      setSelectedGroup(null);
    }
  }, [visible, initialDomain, initialPubkey]);

  // Load raw log once when modal opens
  const loadActivity = useCallback(async () => {
    const log = await rpc<ActivityEntry[]>('getActivityLog') || [];
    rawLog.current = log;
    setLogVersion((v) => v + 1);
    setSelectedGroup(null);
  }, []);

  useEffect(() => {
    if (visible) loadActivity();
  }, [visible, loadActivity]);

  // Build account dropdown options from log data
  const accountOptions = useMemo((): DropdownOption[] => {
    void logVersion;
    const pubkeys = [...new Set(rawLog.current.map((e) => e.pubkey).filter(Boolean))] as string[];
    const opts: DropdownOption[] = [{ value: '', label: t('activity.allAccounts') }];
    for (const pk of pubkeys) {
      const profile = profileCache?.[pk];
      const acct = (accounts || []).find((a) => a.pubkey === pk);
      const label = profile?.name || acct?.name || truncateNpub(pk);
      opts.push({ value: pk, label });
    }
    return opts;
  }, [logVersion, accounts, profileCache]);

  // Compute which methods are present in the filtered log
  const availableMethods = useMemo((): Set<string> => {
    void logVersion;
    let base = rawLog.current;
    if (filter) base = base.filter((e) => e.domain === filter);
    if (accountFilter) base = base.filter((e) => e.pubkey === accountFilter);
    return new Set(base.map((e) => e.method).filter(Boolean) as string[]);
  }, [logVersion, filter, accountFilter]);

  // Build type options dynamically — only show types present in data
  const typeOptions = useMemo((): DropdownOption[] => {
    const opts: DropdownOption[] = [{ value: '', label: t('activity.allOps') }];
    const has = (m: string) => availableMethods.has(m);

    if (has('signEvent'))    opts.push({ value: 'signEvent', label: t('approval.signEvent') });
    if (has('getPublicKey')) opts.push({ value: 'getPublicKey', label: t('perm.readProfile') });

    if (advancedTypes) {
      if (has('nip04Encrypt')) opts.push({ value: 'nip04Encrypt', label: t('activity.sendNip04') });
      if (has('nip44Encrypt')) opts.push({ value: 'nip44Encrypt', label: t('activity.sendNip44') });
      if (has('nip04Decrypt')) opts.push({ value: 'nip04Decrypt', label: t('activity.readNip04') });
      if (has('nip44Decrypt')) opts.push({ value: 'nip44Decrypt', label: t('activity.readNip44') });
    } else {
      if (has('nip04Encrypt') || has('nip44Encrypt')) opts.push({ value: 'encrypt', label: t('activity.sendMessage') });
      if (has('nip04Decrypt') || has('nip44Decrypt')) opts.push({ value: 'decrypt', label: t('activity.readMessage') });
    }

    return opts;
  }, [availableMethods, advancedTypes]);

  // Derive domains from raw log
  const domains = useMemo((): string[] => {
    void logVersion;
    return [...new Set(rawLog.current.map((e) => e.domain).filter(Boolean) as string[])].sort();
  }, [logVersion]);

  // Domain dropdown options
  const domainOptions = useMemo((): DropdownOption[] => [
    { value: '', label: t('activity.allSites') },
    ...domains.map((d) => ({ value: d, label: d })),
  ], [domains]);

  // Filtered + grouped entries
  const entries = useMemo((): GroupedActivity[] => {
    void logVersion;
    let filtered = rawLog.current;

    if (accountFilter) {
      filtered = filtered.filter((e) => e.pubkey === accountFilter);
    }
    if (filter) {
      filtered = filtered.filter((e) => e.domain === filter);
    }
    if (typeFilter) {
      const methods = TYPE_METHODS[typeFilter];
      if (methods) {
        filtered = filtered.filter((e) => methods.includes(e.method!));
      }
    }
    if (pubkeyFilter) {
      const q = pubkeyFilter.toLowerCase();
      filtered = filtered.filter((e) => {
        if (e.theirPubkey && e.theirPubkey.toLowerCase().includes(q)) return true;
        if (e.event?.tags) {
          for (const tag of e.event.tags) {
            if (tag[0] === 'p' && tag[1] && tag[1].toLowerCase().includes(q)) return true;
          }
        }
        return false;
      });
    }

    return groupActivityEntries(filtered, { includeDay: true, includeDomain: true });
  }, [logVersion, accountFilter, filter, typeFilter, pubkeyFilter]);

  // Active filter count for badge
  const activeFilterCount = (typeFilter ? 1 : 0) + (pubkeyFilter ? 1 : 0);

  const handleClear = async () => {
    await rpc('clearActivityLog', {
      domain: filter || undefined,
      accountPubkey: accountFilter || undefined,
      typeFilter: typeFilter || undefined,
      pubkeyFilter: pubkeyFilter || undefined,
    });
    loadActivity();
  };

  const handleClearFilters = () => {
    setTypeFilter('');
    setPubkeyFilter('');
    setAdvancedTypes(false);
  };

  const handleToggleAdvanced = () => {
    setTypeFilter('');
    setAdvancedTypes((v) => !v);
  };

  const { shouldRender, animating } = useAnimatedVisible(visible);

  if (!shouldRender) return null;

  // Group entries by day for display
  interface DayGroupItem {
    type: 'header' | 'entry';
    label?: string;
    idx?: number;
    [key: string]: any;
  }

  const dayGroups: DayGroupItem[] = [];
  let currentDay: string | null = null;
  let entryIdx = 0;
  for (const entry of entries) {
    if (entry.day !== currentDay) {
      currentDay = entry.day!;
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      let dayLabel = entry.day!;
      if (entry.day === today) dayLabel = t('activity.today');
      else if (entry.day === yesterday) dayLabel = t('activity.yesterday');
      dayGroups.push({ type: 'header', label: dayLabel });
    }
    dayGroups.push({ type: 'entry', idx: entryIdx, ...entry });
    entryIdx++;
  }

  const showDomain = !filter;

  return (
    <OverlayPanel title={t('activity.title')} onClose={onClose} animating={animating}>
      <div className={styles.toolbar}>
        <div className={styles.dropdowns}>
          <Dropdown
            options={domainOptions}
            value={filter}
            onChange={(v: string) => { setFilter(v); setTypeFilter(''); }}
            small
          />
          {accountOptions.length > 2 && (
            <Dropdown
              options={accountOptions}
              value={accountFilter}
              onChange={setAccountFilter}
              small
            />
          )}
        </div>
        <button
          className={`${styles.filterToggle} ${activeFilterCount > 0 ? styles.filterToggleActive : ''}`}
          onClick={() => setFiltersOpen(true)}
          title={t('activity.filters')}
        >
          <IconTuner size={16} />
          {activeFilterCount > 0 && (
            <span className={styles.filterBadge}>{activeFilterCount}</span>
          )}
        </button>
        {rawLog.current.length > 0 && (
          <Button variant="danger" small onClick={handleClear}>{t('activity.clearAll')}</Button>
        )}
      </div>

      <div className={styles.list}>
        {dayGroups.length === 0 ? (
          <div className={styles.empty}>
            {t('activity.noActivity')}
          </div>
        ) : (
          dayGroups.map((item, i) =>
            item.type === 'header' ? (
              <div key={`h-${i}`} className={styles.dayHeader}>{item.label}</div>
            ) : (
              <button
                key={`e-${i}`}
                className={styles.entry}
                onClick={() => setSelectedGroup(item as any)}
              >
                <StatusDot status={item.decision} />
                <span className={styles.entryTime}>{item.timeKey}</span>
                {showDomain && item.domain && (
                  <span className={styles.entryDomain}>{item.domain}</span>
                )}
                <span className={styles.entryAction}>{formatLabel(item.methodKey, item.entries?.[0]?.event)}</span>
                {item.count > 1 && (
                  <span className={styles.entryCount}>&times;{item.count}</span>
                )}
              </button>
            )
          )
        )}
      </div>

      {selectedGroup && (
        <EventDetailModal
          group={selectedGroup}
          onBack={() => setSelectedGroup(null)}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      {filtersOpen && (
        <OverlayPanel
          title={t('activity.filters')}
          onBack={() => setFiltersOpen(false)}
          onClose={() => setFiltersOpen(false)}
          zIndex={350}
        >
          <div className={styles.filterPanel}>
            <span className={styles.filterLabel}>{t('activity.filterByType')}</span>
            <ChipGroup
              options={typeOptions}
              value={typeFilter}
              onChange={setTypeFilter}
            />
            <button
              className={styles.advancedToggle}
              onClick={handleToggleAdvanced}
            >
              {advancedTypes ? t('activity.hideProtocols') : t('activity.showProtocols')}
            </button>
          </div>

          <div className={styles.filterPanel}>
            <span className={styles.filterLabel}>{t('activity.filterByPubkey')}</span>
            <Input
              mono
              placeholder={t('activity.pubkeyPlaceholder')}
              value={pubkeyFilter}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPubkeyFilter(e.target.value)}
            />
          </div>

          {activeFilterCount > 0 && (
            <div className={styles.filterActions}>
              <Button variant="secondary" small onClick={handleClearFilters}>
                {t('activity.clearFilters')}
              </Button>
            </div>
          )}
        </OverlayPanel>
      )}
    </OverlayPanel>
  );
}
