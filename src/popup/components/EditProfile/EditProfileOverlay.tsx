import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.js';
import { uploadToBlossom } from '@shared/blossom.js';
import { useAccount } from '../../context/AccountContext';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import { IconCamera, IconChevronDown } from '@assets';
import styles from './EditProfileOverlay.module.css';

const STEPS = { FORM: 0, UPLOADING: 1, PREVIEW: 2, PUBLISHING: 3, DONE: 4 } as const;
type StepValue = typeof STEPS[keyof typeof STEPS];

interface EditProfileOverlayProps {
  visible: boolean;
  onClose: () => void;
}

interface ProfileMetadata {
  name?: string;
  display_name?: string;
  about?: string;
  picture?: string;
  nip05?: string;
  lud16?: string;
  website?: string;
  banner?: string;
  [key: string]: any;
}

export default function EditProfileOverlay({ visible, onClose }: EditProfileOverlayProps) {
  const { active, cachedProfile, reload } = useAccount();
  const fileRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [step, setStep] = useState<StepValue>(STEPS.FORM);
  const [name, setName] = useState<string>('');
  const [about, setAbout] = useState<string>('');
  const [picture, setPicture] = useState<string>('');
  const [nip05, setNip05] = useState<string>('');
  const [lud16, setLud16] = useState<string>('');
  const [website, setWebsite] = useState<string>('');
  const [banner, setBanner] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<ProfileMetadata | null>(null);
  const [error, setError] = useState<string>('');

  // Pre-fill from cachedProfile on open
  useEffect(() => {
    if (!visible) return;
    if (cachedProfile) {
      setName(cachedProfile.name || cachedProfile.display_name || '');
      setAbout(cachedProfile.about || '');
      setPicture(cachedProfile.picture || '');
      setNip05(cachedProfile.nip05 || '');
      setLud16(cachedProfile.lud16 || '');
      setWebsite(cachedProfile.website || '');
      setBanner(cachedProfile.banner || '');
    } else {
      setName(''); setAbout(''); setPicture(''); setNip05('');
      setLud16(''); setWebsite(''); setBanner('');
    }
    setImageFile(null); setImagePreview(null); setError('');
    setStep(STEPS.FORM); setAdvancedOpen(false); setPreviewMeta(null);
    // Revoke old blob URL
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
  }, [visible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const { shouldRender, animating } = useAnimatedVisible(visible);

  if (!shouldRender) return null;

  const initial = (name || active?.name || '?')[0]?.toUpperCase();
  const displayPicture = imagePreview || picture || null;

  const hasChanges = imageFile !== null ||
    name !== (cachedProfile?.name || cachedProfile?.display_name || '') ||
    about !== (cachedProfile?.about || '') ||
    picture !== (cachedProfile?.picture || '') ||
    nip05 !== (cachedProfile?.nip05 || '') ||
    lud16 !== (cachedProfile?.lud16 || '') ||
    website !== (cachedProfile?.website || '') ||
    banner !== (cachedProfile?.banner || '');

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    // Revoke previous blob URL
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setImagePreview(url);
  };

  const buildMetadata = (pictureUrl?: string | null): ProfileMetadata => {
    // Merge with existing profile to preserve unknown fields
    const metadata: ProfileMetadata = cachedProfile ? { ...cachedProfile } : {};
    if (name) metadata.name = name;
    else delete metadata.name;
    if (about) metadata.about = about;
    else delete metadata.about;
    if (pictureUrl) metadata.picture = pictureUrl;
    else if (picture) metadata.picture = picture;
    else delete metadata.picture;
    if (nip05) metadata.nip05 = nip05;
    else delete metadata.nip05;
    if (lud16) metadata.lud16 = lud16;
    else delete metadata.lud16;
    if (website) metadata.website = website;
    else delete metadata.website;
    if (banner) metadata.banner = banner;
    else delete metadata.banner;
    if (name) metadata.display_name = name;
    return metadata;
  };

  const handlePublish = async () => {
    if (!name && !about) {
      setError(t('profileEdit.fillOneField'));
      return;
    }
    setError('');

    let uploadedUrl: string | null = null;
    try {
      if (imageFile) {
        setStep(STEPS.UPLOADING);
        const result = await uploadToBlossom(imageFile);
        uploadedUrl = result.url;
      }

      const metadata = buildMetadata(uploadedUrl);
      setPreviewMeta(metadata);
      setPicture(uploadedUrl || picture);
      setStep(STEPS.PREVIEW);
    } catch (err: any) {
      setError(err.message || t('profileEdit.uploadFailed'));
      setStep(STEPS.FORM);
    }
  };

  const handleConfirmPublish = async () => {
    setStep(STEPS.PUBLISHING);
    setError('');
    try {
      const event = {
        created_at: Math.floor(Date.now() / 1000),
        kind: 0,
        tags: [] as string[][],
        content: JSON.stringify(previewMeta),
      };
      await rpc('signAndPublishEvent', { event });
      await rpc('updateProfileCache', { pubkey: active!.pubkey, metadata: previewMeta });
      reload();
      setStep(STEPS.DONE);
      closeTimerRef.current = setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      setError(err.message || t('profileEdit.publishFailed'));
      setStep(STEPS.PREVIEW);
    }
  };

  const renderForm = () => (
    <div className={styles.body}>
      <div className={styles.avatarPicker}>
        <div className={styles.avatarCircle} onClick={() => fileRef.current?.click()}>
          {displayPicture ? (
            <img src={displayPicture} alt="" className={styles.avatarImg} />
          ) : (
            <span className={styles.avatarPlaceholder}>{initial}</span>
          )}
          <div className={styles.cameraOverlay}>
            <IconCamera size={14} />
          </div>
        </div>
        <span className={styles.avatarHint}>
          {displayPicture ? t('profileEdit.changeImage') : t('profileEdit.uploadImage')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFilePick}
        />
      </div>

      <div className={styles.form}>
        <Input
          label={t('profileEdit.displayName')}
          placeholder={t('profileEdit.namePlaceholder')}
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
        <Input
          label={t('profileEdit.about')}
          placeholder={t('profileEdit.aboutPlaceholder')}
          value={about}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAbout(e.target.value)}
        />

        <button
          className={styles.advancedToggle}
          data-open={advancedOpen}
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <IconChevronDown size={14} />
          {t('profileEdit.advanced')}
        </button>

        {advancedOpen && (
          <div className={styles.advancedFields}>
            <Input
              label={t('profileEdit.nip05')}
              placeholder={t('profileEdit.nip05Placeholder')}
              value={nip05}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNip05(e.target.value)}
            />
            <Input
              label={t('profileEdit.lightning')}
              placeholder={t('profileEdit.lightningPlaceholder')}
              value={lud16}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLud16(e.target.value)}
            />
            <Input
              label={t('profileEdit.website')}
              placeholder={t('profileEdit.websitePlaceholder')}
              value={website}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setWebsite(e.target.value)}
            />
            <Input
              label={t('profileEdit.banner')}
              placeholder={t('profileEdit.bannerPlaceholder')}
              value={banner}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBanner(e.target.value)}
            />
          </div>
        )}
      </div>

      {error && <div className={styles.errorText}>{error}</div>}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={handlePublish} disabled={!hasChanges}>{t('profileEdit.publish')}</Button>
      </div>
    </div>
  );

  const renderUploading = () => (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <div className={styles.spinner} />
        <span className={styles.statusText}>{t('profileEdit.uploading')}</span>
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className={styles.body}>
      <div className={styles.previewCard}>
        <div className={styles.previewHeader}>
          {previewMeta?.picture ? (
            <img src={previewMeta.picture} alt="" className={styles.previewAvatar} />
          ) : (
            <div className={styles.previewAvatarPlaceholder}>{initial}</div>
          )}
          <span className={styles.previewName}>{previewMeta?.name || previewMeta?.display_name || '\u2014'}</span>
        </div>
        {previewMeta?.about && <div className={styles.previewAbout}>{previewMeta.about}</div>}
        {previewMeta?.nip05 && (
          <dl className={styles.previewField}>
            <dt>NIP-05</dt><dd>{previewMeta.nip05}</dd>
          </dl>
        )}
        {previewMeta?.lud16 && (
          <dl className={styles.previewField}>
            <dt>Lightning</dt><dd>{previewMeta.lud16}</dd>
          </dl>
        )}
        {previewMeta?.website && (
          <dl className={styles.previewField}>
            <dt>Website</dt><dd>{previewMeta.website}</dd>
          </dl>
        )}
      </div>

      <div className={styles.previewHint}>{t('profileEdit.previewHint')}</div>

      {error && <div className={styles.errorText}>{error}</div>}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => { setStep(STEPS.FORM); setError(''); }}>
          {t('common.back')}
        </Button>
        <Button onClick={handleConfirmPublish}>{t('profileEdit.confirmPublish')}</Button>
      </div>
    </div>
  );

  const renderPublishing = () => (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <div className={styles.spinner} />
        <span className={styles.statusText}>{t('common.publishing')}</span>
      </div>
    </div>
  );

  const renderDone = () => (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <span className={styles.successText}>{t('profileEdit.published')}</span>
      </div>
    </div>
  );

  const stepContent: Record<StepValue, () => React.ReactNode> = {
    [STEPS.FORM]: renderForm,
    [STEPS.UPLOADING]: renderUploading,
    [STEPS.PREVIEW]: renderPreview,
    [STEPS.PUBLISHING]: renderPublishing,
    [STEPS.DONE]: renderDone,
  };

  return (
    <OverlayPanel
      title={t('profileEdit.title')}
      onClose={step === STEPS.PUBLISHING ? undefined : onClose}
      onBack={step === STEPS.PREVIEW ? () => { setStep(STEPS.FORM); setError(''); } : null}
      animating={animating}
    >
      {(stepContent[step] || renderForm)()}
    </OverlayPanel>
  );
}
