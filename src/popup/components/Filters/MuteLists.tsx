import React, { useState } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import useRpc from '@shared/hooks/useRpc.js';
import Button from '@components/Button/Button';
import InputRow from '@components/InputRow/InputRow';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import EmptyState from '@components/EmptyState/EmptyState';
import styles from './Filters.module.css';

interface MuteList {
  pubkey: string;
  name?: string;
  count?: number;
  entries?: any[];
  disabled?: boolean;
}

interface Preview {
  pubkey: string;
  name: string;
  entries: any[];
}

export default function MuteLists() {
  const { data: lists, reload: loadLists } = useRpc('getMuteLists', {}, { defaultValue: [] }) as { data: MuteList[]; reload: () => void };
  const [importPubkey, setImportPubkey] = useState<string>('');
  const [importError, setImportError] = useState<string>('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);

  const handleFetch = async () => {
    const pk = importPubkey.trim();
    if (!pk) { setImportError(t('filters.enterPublicKey')); return; }
    setImportError('');
    setFetching(true);
    try {
      const result = await rpc<{ entries?: any[] }>('fetchMuteList', { pubkey: pk });
      if (result?.entries?.length && result.entries.length > 0) {
        // Get name for display
        let name = pk;
        try {
          const meta = await rpc<{ name?: string }>('getProfileMetadata', { pubkey: pk });
          if (meta?.name) name = meta.name;
        } catch { /* ignore */ }
        setPreview({ pubkey: pk, name, entries: result.entries });
      } else {
        setImportError(t('filters.noMuteListFound'));
      }
    } catch {
      setImportError(t('filters.failedFetchMute'));
    }
    setFetching(false);
  };

  const handleImport = async () => {
    if (!preview) return;
    await rpc('saveMuteList', { pubkey: preview.pubkey, name: preview.name, entries: preview.entries });
    setPreview(null);
    setImportPubkey('');
    loadLists();
  };

  const handleToggle = async (pubkey: string) => {
    await rpc('toggleMuteList', { pubkey });
    loadLists();
  };

  const handleRemove = async (pubkey: string) => {
    await rpc('removeMuteList', { pubkey });
    loadLists();
  };

  return (
    <>
      <label className={styles.inputLabel}>{t('filters.importMuteListLabel')}</label>
      <InputRow
        value={importPubkey}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImportPubkey(e.target.value)}
        placeholder={t('filters.pubkeyPlaceholder')}
        onSubmit={handleFetch}
        buttonLabel={fetching ? t('common.fetching') : t('common.fetch')}
        disabled={fetching}
        error={importError}
        mono
      />

      {preview && (
        <div className={styles.importPreview}>
          <span className={styles.importPreviewText}>
            {preview.name}: {t('event.nEntries', { count: preview.entries.length })}
          </span>
          <Button small onClick={handleImport}>{t('common.add')}</Button>
        </div>
      )}

      <div className={styles.blockList}>
        {lists.map((list) => (
          <div key={list.pubkey} className={`${styles.muteItem} ${list.disabled ? styles.muteItemDisabled : ''}`}>
            <div className={styles.muteInfo}>
              <div className={styles.muteName}>{list.name || list.pubkey}</div>
              <div className={styles.muteCount}>{t('event.nEntries', { count: list.count || list.entries?.length || 0 })}</div>
            </div>
            <button
              className={`${styles.muteToggle} ${!list.disabled ? styles.muteToggleActive : ''}`}
              onClick={() => handleToggle(list.pubkey)}
            >
              {list.disabled ? t('filters.enable') : t('common.active')}
            </button>
            <RemoveButton onClick={() => handleRemove(list.pubkey)} />
          </div>
        ))}
      </div>

      {lists.length === 0 && !preview && (
        <EmptyState text={t('filters.noMuteLists')} hint={t('filters.noMuteListsHint')} />
      )}
    </>
  );
}
