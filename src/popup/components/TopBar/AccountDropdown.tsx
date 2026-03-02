import React, { useState, useEffect, useRef, MouseEvent, SyntheticEvent } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { npubEncode } from '@lib/crypto/bech32.js';
import { useAccount } from '../../context/AccountContext';
import { truncateNpub, getInitial } from '@shared/format/text.ts';
import { IconClose, IconCopy, IconPencil } from '@assets';
import Button from '@components/Button/Button';
import styles from './TopBar.module.css';

interface AccountDropdownProps {
  onClose: () => void;
  onAddAccount: () => void;
  onEditProfile: () => void;
}

interface CopyMenuPos {
  top: number;
  right: number;
}

export default function AccountDropdown({ onClose, onAddAccount, onEditProfile }: AccountDropdownProps) {
  const { accounts, activeId, profileCache, switchAccount, reload } = useAccount();
  const ref = useRef<HTMLDivElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<boolean>(false);
  const [copyMenuId, setCopyMenuId] = useState<string | null>(null);
  const [copyMenuPos, setCopyMenuPos] = useState<CopyMenuPos | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleCopy = async (pubkey: string, format: 'npub' | 'hex') => {
    const text = format === 'npub' ? npubEncode(pubkey) : pubkey;
    await navigator.clipboard.writeText(text);
    setCopyMenuId(null);
    setCopyMenuPos(null);
    setCopiedId(pubkey);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const confirmAccount = confirmId ? (accounts || []).find((a) => a.id === confirmId) : null;
  const isWriteAccount = confirmAccount && !confirmAccount.readOnly && confirmAccount.type !== 'npub';

  const handleRemove = async () => {
    if (!confirmId) return;
    setRemoving(true);
    try {
      try { await rpc('vault_removeAccount', { accountId: confirmId }); } catch {}
      try { await rpc('deleteAccountDatabase', { accountId: confirmId }); } catch {}
      // Clean up local accounts array
      const data: any = await browser.storage.local.get(['accounts', 'activeAccountId']);
      const remaining = (data.accounts || []).filter((a: any) => a.id !== confirmId);
      const updates: Record<string, any> = { accounts: remaining };
      if (data.activeAccountId === confirmId) {
        updates.activeAccountId = remaining[0]?.id || null;
      }
      // Clear synced pubkey BEFORE updating local accounts so the migration
      // code in AccountContext.load() doesn't re-create the account
      if (remaining.length === 0) {
        await browser.storage.sync.remove('myPubkey');
      } else if (updates.activeAccountId) {
        const newActive = remaining.find((a: any) => a.id === updates.activeAccountId);
        if (newActive?.pubkey) {
          await browser.storage.sync.set({ myPubkey: newActive.pubkey });
        }
      }
      await browser.storage.local.set(updates);
      setConfirmId(null);
      onClose();
      reload();
    } catch {}
    setRemoving(false);
  };

  return (
    <div className={styles.dropdown} ref={ref}>
      <div className={styles.accountList}>
        {(accounts || []).map((account) => {
          const cached = profileCache[account.pubkey];
          const name = cached?.name || account.name;
          const isActive = account.id === activeId;

          return (
            <div
              key={account.id}
              className={`${styles.dropdownItem} ${isActive ? styles.dropdownItemActive : ''}`}
            >
              <button
                className={styles.accountBarToggle}
                onClick={() => {
                  setCopyMenuId(null);
                  setCopyMenuPos(null);
                  switchAccount(account.id);
                  onClose();
                }}
              >
                <div className={styles.dropdownAvatar}>
                  {cached?.picture ? (
                    <img
                      className={styles.avatar}
                      src={cached.picture}
                      alt=""
                      onError={(e: SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    getInitial(name)
                  )}
                </div>
                <div className={styles.dropdownInfo}>
                  <div className={styles.dropdownNameRow}>
                    <span className={styles.dropdownName}>{name}</span>
                    {(account.readOnly || account.type === 'npub') && (
                      <span className={styles.dropdownReadOnly}>{t('account.readOnly')}</span>
                    )}
                  </div>
                  <span className={styles.dropdownSub}>{cached?.nip05 || truncateNpub(account.pubkey)}</span>
                </div>
                {isActive && <span className={styles.dropdownCheck}>&#10003;</span>}
              </button>
              <div className={styles.dropdownActions}>
                {!account.readOnly && account.type !== 'npub' && (
                  <button
                    className={styles.dropdownEditBtn}
                    title={t('settings.editProfile')}
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      switchAccount(account.id);
                      onClose();
                      onEditProfile();
                    }}
                  >
                    <IconPencil size={13} />
                  </button>
                )}
                <div className={styles.copyWrap}>
                  {copiedId === account.pubkey ? (
                    <span className={styles.copiedLabel}>{t('common.copied')}</span>
                  ) : (
                    <button
                      className={styles.dropdownCopyBtn}
                      title={t('common.copy')}
                      onClick={(e: MouseEvent<HTMLButtonElement>) => {
                        e.stopPropagation();
                        if (copyMenuId === account.id) {
                          setCopyMenuId(null);
                          setCopyMenuPos(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setCopyMenuPos({ top: rect.bottom + 2, right: window.innerWidth - rect.right });
                          setCopyMenuId(account.id);
                        }
                      }}
                    >
                      <IconCopy size={13} />
                    </button>
                  )}
                  {copyMenuId === account.id && copyMenuPos && (
                    <div className={styles.copyMenu} style={{ top: copyMenuPos.top, right: copyMenuPos.right }}>
                      <button
                        className={styles.copyMenuItem}
                        onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleCopy(account.pubkey, 'npub'); }}
                      >
                        npub
                      </button>
                      <button
                        className={styles.copyMenuItem}
                        onClick={(e: MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleCopy(account.pubkey, 'hex'); }}
                      >
                        hex
                      </button>
                    </div>
                  )}
                </div>
                <button
                  className={styles.dropdownRemoveBtn}
                  title={t('account.remove')}
                  onClick={(e: MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    setConfirmId(account.id);
                  }}
                >
                  <IconClose size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmAccount && (
        <div className={styles.removeConfirm}>
          <div className={styles.removeConfirmTitle}>
            {t('account.removeTitle', { name: profileCache[confirmAccount.pubkey]?.name || confirmAccount.name || '' })}
          </div>
          <div className={styles.removeConfirmWarning}>
            {t('account.removeWarning')}
          </div>
          {isWriteAccount && (
            <div className={styles.removeConfirmKeyWarning}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{t('account.removeKeyWarning')}</span>
            </div>
          )}
          <div className={styles.removeConfirmActions}>
            <Button variant="secondary" small onClick={() => setConfirmId(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" small onClick={handleRemove} disabled={removing}>
              {removing ? t('common.removing') : t('common.remove')}
            </Button>
          </div>
        </div>
      )}

      <button className={styles.dropdownAdd} onClick={onAddAccount}>
        + {t('account.addAccount')}
      </button>
    </div>
  );
}
