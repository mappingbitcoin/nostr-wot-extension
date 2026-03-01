import React from 'react';
import { t } from '@lib/i18n.js';
import Toggle from '@components/Toggle/Toggle';
import Card from '@components/Card/Card';
import { IconUser, IconEye, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

interface SiteControlsProps {
  identityEnabled: boolean;
  wotEnabled: boolean;
  canInject: boolean;
  onIdentityToggle: (checked: boolean) => void;
  onWotToggle: (checked: boolean) => void;
  onManagePermissions: () => void;
  onManageFilters: () => void;
}

export default function SiteControls({
  identityEnabled,
  wotEnabled,
  canInject,
  onIdentityToggle,
  onWotToggle,
  onManagePermissions,
  onManageFilters,
}: SiteControlsProps) {
  return (
    <Card className={styles.siteControls}>
      <div className={styles.controlRow}>
        <div className={styles.controlInfo}>
          <IconUser size={15} className={styles.controlIcon} />
          <span className={styles.controlLabel}>{t('home.allowIdentity')}</span>
        </div>
        <Toggle checked={identityEnabled} onChange={onIdentityToggle} />
      </div>

      {canInject && (
        <div className={styles.controlRow}>
          <div className={styles.controlInfo}>
            <IconEye size={15} className={styles.controlIcon} />
            <span className={styles.controlLabel}>{t('home.showTrustScores')}</span>
          </div>
          <Toggle checked={wotEnabled} onChange={onWotToggle} />
        </div>
      )}

      <div className={styles.controlDivider} />

      <button className={styles.controlLink} onClick={onManagePermissions}>
        <span>{t('home.managePermissions')}</span>
        <IconChevronRight size={14} />
      </button>

      <button className={styles.controlLink} onClick={onManageFilters}>
        <span>{t('home.manageFilters')}</span>
        <IconChevronRight size={14} />
      </button>
    </Card>
  );
}
