import React from 'react';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import { IconUser } from '@assets';
import styles from './HomeTab.module.css';

interface ProfileSuggestionProps {
  onEdit: () => void;
  onDismiss: () => void;
}

export default function ProfileSuggestion({ onEdit, onDismiss }: ProfileSuggestionProps) {
  return (
    <Card className={styles.profileSuggestion}>
      <div className={styles.profileSuggestionContent}>
        <IconUser size={20} className={styles.profileSuggestionIcon} />
        <div className={styles.profileSuggestionText}>
          <strong>{t('home.setupProfile')}</strong>
          <span>{t('home.setupProfileHint')}</span>
        </div>
      </div>
      <div className={styles.profileSuggestionActions}>
        <Button small onClick={onEdit}>{t('home.setupProfileButton')}</Button>
        <button className={styles.profileDismiss} onClick={onDismiss}>{t('home.skip')}</button>
      </div>
    </Card>
  );
}
