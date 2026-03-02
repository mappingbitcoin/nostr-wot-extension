import React from 'react';
import { t } from '@lib/i18n.js';
import styles from '../EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface ProfileMeta {
  name?: string;
  display_name?: string;
  picture?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
}

interface ProfilePreviewProps {
  event: NostrEvent;
}

export default function ProfilePreview({ event }: ProfilePreviewProps) {
  try {
    const meta: ProfileMeta = JSON.parse(event.content);
    const displayName = meta.name || meta.display_name || '';
    const initial = displayName ? displayName[0].toUpperCase() : '?';

    return (
      <>
        <h3 className={styles.sectionTitle}>{t('event.profileUpdate')}</h3>
        <div className={styles.profileCard}>
          {meta.banner && (
            <div className={styles.profileBanner}>
              <img src={meta.banner} alt="" />
            </div>
          )}
          <div className={styles.profileHeader}>
            {meta.picture ? (
              <img src={meta.picture} alt="" className={styles.profileAvatar} />
            ) : (
              <div className={styles.profileAvatarPlaceholder}>{initial}</div>
            )}
            <span className={styles.profileName}>{displayName || '\u2014'}</span>
          </div>
          {meta.about && <div className={styles.profileAbout}>{meta.about}</div>}
          {meta.nip05 && (
            <dl className={styles.profileField}>
              <dt>NIP-05</dt><dd>{meta.nip05}</dd>
            </dl>
          )}
          {meta.lud16 && (
            <dl className={styles.profileField}>
              <dt>{t('event.lightning')}</dt><dd>{meta.lud16}</dd>
            </dl>
          )}
          {meta.website && (
            <dl className={styles.profileField}>
              <dt>{t('profileEdit.website')}</dt><dd>{meta.website}</dd>
            </dl>
          )}
        </div>
      </>
    );
  } catch {
    return <div className={styles.eventNote}>{t('event.noEventData')}</div>;
  }
}
