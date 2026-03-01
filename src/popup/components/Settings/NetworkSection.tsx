import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { KNOWN_ORACLES, DEFAULT_RELAYS } from '@shared/constants.ts';
import { formatTimeAgo } from '@shared/format/time.ts';
import { isValidWssUrl, isValidHttpsUrl } from '@shared/url.ts';
import Button from '@components/Button/Button';
import InputRow from '@components/InputRow/InputRow';
import StatusDot from '@components/StatusDot/StatusDot';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Settings.module.css';

interface EndpointListProps {
  items: string[];
  health: Record<string, string>;
  inputValue: string;
  onInputChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  onAdd: () => void;
  onRemove: (url: string) => void;
  error: string;
  renderExtra?: (url: string) => React.ReactNode;
}

function EndpointList({ items, health, inputValue, onInputChange, placeholder, onAdd, onRemove, error, renderExtra }: EndpointListProps) {
  return (
    <>
      <div className={styles.relayList}>
        {items.map((url) => (
          <div key={url} className={styles.relayRow}>
            <StatusDot status={health[url]} />
            <span className={styles.relayUrl}>{url.replace(/^wss:\/\/|^https:\/\//, '')}</span>
            {renderExtra?.(url)}
            <RemoveButton onClick={() => onRemove(url)} />
          </div>
        ))}
      </div>
      <InputRow
        value={inputValue}
        onChange={onInputChange}
        placeholder={placeholder}
        onSubmit={onAdd}
        buttonLabel={t('common.add')}
        error={error}
        mono
      />
    </>
  );
}

interface RelayFlags {
  read: boolean;
  write: boolean;
}

export default function NetworkSection() {
  const [relays, setRelays] = useState<string[]>([]);
  const [relayFlags, setRelayFlags] = useState<Record<string, RelayFlags>>({});
  const [relayHealth, setRelayHealth] = useState<Record<string, string>>({});
  const [newRelay, setNewRelay] = useState<string>('');
  const [relayError, setRelayError] = useState<string>('');

  const [oracles, setOracles] = useState<string[]>([]);
  const [oracleHealth, setOracleHealth] = useState<Record<string, string>>({});
  const [newOracle, setNewOracle] = useState<string>('');
  const [oracleError, setOracleError] = useState<string>('');

  const [lastPublish, setLastPublish] = useState<number | null>(null);
  const [publishUnsaved, setPublishUnsaved] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);

  const mounted = useRef<boolean>(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    (async () => {
      const syncData: any = await browser.storage.sync.get(['relays', 'oracleUrl']);
      const localData: any = await browser.storage.local.get(['relayFlags', 'lastRelayPublish', 'lastPublishedRelays']);

      const relayStr: string = syncData.relays || DEFAULT_RELAYS;
      const relayList = relayStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      setRelays(relayList);
      setRelayFlags(localData.relayFlags || {});

      const oracleStr: string = syncData.oracleUrl || KNOWN_ORACLES[0];
      const oracleList = oracleStr.split(',').map((s: string) => s.trim()).filter(Boolean);
      setOracles(oracleList);

      if (localData.lastRelayPublish) {
        setLastPublish(localData.lastRelayPublish);
      }
      if (localData.lastPublishedRelays && localData.lastPublishedRelays !== relayStr) {
        setPublishUnsaved(true);
      }

      // Check health
      for (const url of relayList) checkRelay(url);
      for (const url of oracleList) checkOracle(url);
    })();
  }, []);

  const checkRelay = async (url: string) => {
    setRelayHealth((h) => ({ ...h, [url]: 'checking' }));
    try {
      const result = await rpc<{ reachable?: boolean }>('checkRelayHealth', { url });
      if (mounted.current) setRelayHealth((h) => ({ ...h, [url]: result?.reachable ? 'reachable' : 'unreachable' }));
    } catch {
      if (mounted.current) setRelayHealth((h) => ({ ...h, [url]: 'unreachable' }));
    }
  };

  const checkOracle = async (url: string) => {
    setOracleHealth((h) => ({ ...h, [url]: 'checking' }));
    try {
      const result = await rpc<{ reachable?: boolean }>('checkOracleHealth', { url });
      if (mounted.current) setOracleHealth((h) => ({ ...h, [url]: result?.reachable ? 'reachable' : 'unreachable' }));
    } catch {
      if (mounted.current) setOracleHealth((h) => ({ ...h, [url]: 'unreachable' }));
    }
  };

  const saveRelays = async (list: string[], flags: Record<string, RelayFlags>) => {
    const str = list.join(',');
    await browser.storage.sync.set({ relays: str });
    await browser.storage.local.set({ relayFlags: flags });
    rpcNotify('configUpdated');
  };

  const saveOracles = async (list: string[]) => {
    await browser.storage.sync.set({ oracleUrl: list.join(',') });
    rpcNotify('configUpdated');
  };

  const addRelay = () => {
    const url = newRelay.trim();
    if (!url) return;
    if (!isValidWssUrl(url)) { setRelayError(t('network.mustBeWss')); return; }
    if (relays.includes(url)) { setRelayError(t('network.relayAlreadyAdded')); return; }
    const updated = [...relays, url];
    setRelays(updated);
    setNewRelay('');
    setRelayError('');
    saveRelays(updated, relayFlags);
    checkRelay(url);
  };

  const removeRelay = (url: string) => {
    const updated = relays.filter((r) => r !== url);
    const newFlags = { ...relayFlags };
    delete newFlags[url];
    setRelays(updated);
    setRelayFlags(newFlags);
    saveRelays(updated, newFlags);
  };

  const toggleRelayFlag = (url: string, flag: 'read' | 'write') => {
    const current = relayFlags[url] || { read: true, write: true };
    const newFlags = { ...relayFlags, [url]: { ...current, [flag]: !current[flag] } };
    setRelayFlags(newFlags);
    saveRelays(relays, newFlags);
  };

  const addOracle = () => {
    const url = newOracle.trim();
    if (!url) return;
    if (!isValidHttpsUrl(url)) { setOracleError(t('network.mustBeHttps')); return; }
    if (oracles.includes(url)) { setOracleError(t('network.oracleAlreadyAdded')); return; }
    const updated = [...oracles, url];
    setOracles(updated);
    setNewOracle('');
    setOracleError('');
    saveOracles(updated);
    checkOracle(url);
  };

  const removeOracle = (url: string) => {
    const updated = oracles.filter((o) => o !== url);
    setOracles(updated);
    saveOracles(updated);
  };

  const publishRelayList = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ sent?: boolean }>('publishRelayList');
      if (result?.sent) {
        setLastPublish(Date.now());
        setPublishUnsaved(false);
        setPublishResult('success');
      } else {
        setPublishResult('error');
      }
    } catch {
      setPublishResult('error');
    }
    setPublishing(false);
    setTimeout(() => setPublishResult(null), 3000);
  };

  return (
    <div className={styles.section}>
      <SectionLabel>{t('network.identityRelays')}</SectionLabel>
      <EndpointList
        items={relays}
        health={relayHealth}
        inputValue={newRelay}
        onInputChange={(e: ChangeEvent<HTMLInputElement>) => { setNewRelay(e.target.value); setRelayError(''); }}
        placeholder={t('network.relayPlaceholder')}
        onAdd={addRelay}
        onRemove={removeRelay}
        error={relayError}
        renderExtra={(url) => {
          const flags = relayFlags[url] || { read: true, write: true };
          return (
            <div className={styles.relayChips}>
              <button
                className={`${styles.relayChip} ${flags.read ? styles.relayChipActive : ''}`}
                onClick={() => toggleRelayFlag(url, 'read')}
              >R</button>
              <button
                className={`${styles.relayChip} ${flags.write ? styles.relayChipActive : ''}`}
                onClick={() => toggleRelayFlag(url, 'write')}
              >W</button>
            </div>
          );
        }}
      />

      <div className={styles.publishRow}>
        <span className={`${styles.publishInfo} ${publishUnsaved ? styles.publishUnsaved : ''} ${publishResult === 'success' ? styles.publishSuccess : ''} ${publishResult === 'error' ? styles.publishError : ''}`}>
          {publishing
            ? t('common.publishing')
            : publishResult === 'success'
              ? t('network.relayListPublished')
              : publishResult === 'error'
                ? t('network.relayListFailed')
                : publishUnsaved
                  ? t('network.relayListChanged')
                  : lastPublish
                    ? t('network.lastPublished', { time: formatTimeAgo(lastPublish) })
                    : t('network.notPublishedYet')}
        </span>
        {publishing && <div className={styles.publishSpinner} />}
        <Button small variant="secondary" onClick={publishRelayList} disabled={publishing}>{t('common.publish')}</Button>
      </div>

      <SectionLabel style={{ marginTop: 12 }}>{t('network.wotOracles')}</SectionLabel>
      <EndpointList
        items={oracles}
        health={oracleHealth}
        inputValue={newOracle}
        onInputChange={(e: ChangeEvent<HTMLInputElement>) => { setNewOracle(e.target.value); setOracleError(''); }}
        placeholder={t('network.oraclePlaceholder')}
        onAdd={addOracle}
        onRemove={removeOracle}
        error={oracleError}
        renderExtra={(url) => (
          <span className={KNOWN_ORACLES.includes(url) ? styles.verifiedBadge : styles.unverifiedBadge}>
            {KNOWN_ORACLES.includes(url) ? t('badges.verified') : t('badges.custom')}
          </span>
        )}
      />
    </div>
  );
}
