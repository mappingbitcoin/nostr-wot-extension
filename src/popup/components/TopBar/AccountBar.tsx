import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronDown, IconLock, IconLockOpen } from '@assets';
import { useAccount } from '../../context/AccountContext';
import { useVault } from '../../context/VaultContext';
import styles from './TopBar.module.css';

interface AccountBarProps {
  dropdownOpen: boolean;
  onToggleDropdown: () => void;
}

export default function AccountBar({ dropdownOpen, onToggleDropdown }: AccountBarProps) {
  const { displayName, displaySub, avatarUrl, initial, isReadOnly, active } = useAccount();
  const vault = useVault();
  const [imgError, setImgError] = useState<boolean>(false);

  const showAvatar = avatarUrl && !imgError;
  const fallbackText = !active ? '+' : isReadOnly ? '\u{1F441}' : initial;

  return (
    <div className={styles.accountBar}>
      <button className={styles.accountBarToggle} onClick={onToggleDropdown}>
        <div className={styles.avatarWrap}>
          {showAvatar ? (
            <img
              className={styles.avatar}
              src={avatarUrl!}
              alt=""
              onError={() => setImgError(true)}
            />
          ) : (
            <div className={styles.avatarFallback}>{fallbackText}</div>
          )}
        </div>
        <div className={styles.barInfo}>
          <div className={styles.barNameRow}>
            <span className={styles.barName}>{displayName}</span>
            {isReadOnly && <span className={styles.readOnlyBadge}>{t('account.readOnly')}</span>}
          </div>
          <span className={styles.barSub}>{displaySub}</span>
        </div>
        <IconChevronDown className={`${styles.chevron} ${dropdownOpen ? styles.chevronOpen : ''}`} />
      </button>

      {vault.exists && !isReadOnly && vault.autoLockEnabled && (
        <button
          className={`${styles.lockBtn} ${vault.locked ? styles.lockLocked : styles.lockUnlocked}`}
          title={vault.locked ? t('topbar.vaultLocked') : t('topbar.vaultUnlocked')}
          onClick={(e) => {
            e.stopPropagation();
            vault.locked ? null : vault.lock(); // unlock handled by UnlockModal
          }}
        >
          {vault.locked ? (
            <IconLock size={14} />
          ) : (
            <IconLockOpen />
          )}
        </button>
      )}
    </div>
  );
}
