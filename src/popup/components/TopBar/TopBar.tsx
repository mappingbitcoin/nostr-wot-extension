import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import { IconSettings } from '@assets';
import AccountBar from './AccountBar';
import AccountDropdown from './AccountDropdown';
import GlobeButton from './GlobeButton';
import styles from './TopBar.module.css';

interface TopBarProps {
  onMenuOpen: () => void;
  onAddAccount: () => void;
}

export default function TopBar({ onMenuOpen, onAddAccount }: TopBarProps) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  return (
    <div className={styles.topBar}>
      <div className={styles.accountWrap}>
        <AccountBar
          dropdownOpen={dropdownOpen}
          onToggleDropdown={() => setDropdownOpen((v) => !v)}
        />
        {dropdownOpen && (
          <AccountDropdown onClose={() => setDropdownOpen(false)} onAddAccount={() => { setDropdownOpen(false); onAddAccount?.(); }} />
        )}
      </div>
      <GlobeButton />
      <button className={styles.menuBtn} title={t('topbar.settings')} onClick={onMenuOpen}>
        <IconSettings />
      </button>
    </div>
  );
}
