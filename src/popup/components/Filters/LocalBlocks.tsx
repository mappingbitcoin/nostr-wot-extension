import React, { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { truncateNpub } from '@shared/format/text.js';
import useRpc from '@shared/hooks/useRpc.js';
import Button from '@components/Button/Button';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import EmptyState from '@components/EmptyState/EmptyState';
import styles from './Filters.module.css';

interface Block {
  pubkey: string;
  note?: string;
}

export default function LocalBlocks() {
  const { data: blocks, reload: loadBlocks } = useRpc('getLocalBlocks', {}, { defaultValue: [] }) as { data: Block[]; reload: () => void };
  const [pubkey, setPubkey] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleAdd = async () => {
    const pk = pubkey.trim();
    if (!pk) { setError(t('filters.enterPublicKey')); return; }
    setError('');
    try {
      await rpc('addLocalBlock', { pubkey: pk, note: note.trim() });
      setPubkey('');
      setNote('');
      loadBlocks();
    } catch (e: any) {
      setError(e.message || t('filters.invalidPublicKey'));
    }
  };

  const handleRemove = async (pk: string) => {
    await rpc('removeLocalBlock', { pubkey: pk });
    loadBlocks();
  };

  return (
    <>
      <div className={styles.addRow}>
        <div className={styles.addField}>
          <label>{t('filters.pubkeyLabel')}</label>
          <input
            placeholder={t('filters.pubkeyPlaceholder')}
            value={pubkey}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPubkey(e.target.value)}
          />
        </div>
        <div className={styles.addField} style={{ maxWidth: 100 }}>
          <label>{t('filters.noteLabel')}</label>
          <input
            placeholder={t('filters.optionalPlaceholder')}
            value={note}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
          />
        </div>
        <Button small onClick={handleAdd}>{t('common.add')}</Button>
      </div>
      {error && <div className={styles.addError}>{error}</div>}

      <div className={styles.blockList}>
        {blocks.map((b) => (
          <div key={b.pubkey} className={styles.blockItem}>
            <span className={styles.blockPubkey} title={b.pubkey}>
              {truncateNpub(b.pubkey)}
            </span>
            {b.note && <span className={styles.blockNote} title={b.note}>{b.note}</span>}
            <RemoveButton onClick={() => handleRemove(b.pubkey)} />
          </div>
        ))}
      </div>

      {blocks.length === 0 && (
        <EmptyState text={t('filters.noLocalBlocks')} hint={t('filters.noLocalBlocksHint')} />
      )}
    </>
  );
}
