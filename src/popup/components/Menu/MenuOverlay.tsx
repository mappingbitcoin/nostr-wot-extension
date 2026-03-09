import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { t, getSupportedLanguages, getLanguage, setLanguage } from '@lib/i18n.js';
import { IconLock, IconShield, IconUsers, IconGlobe, IconKey, IconDownload, IconZap } from '@assets';
import iconBaseSvg from '/icons/icon-base.svg';
import { version as appVersion } from '../../../../package.json';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import Button from '@components/Button/Button';
import MenuSection from './MenuSection';
import PermissionsSection from '../Settings/PermissionsSection';
import SecuritySection from '../Settings/SecuritySection';
import NetworkSection from '../Settings/NetworkSection';
import WotModeSection from '../Settings/WotModeSection';
import WotInjectionSection, { WotInjectionDetail } from '../Settings/WotInjectionSection';
import WotSyncSection, { WotSyncDetail } from '../Settings/WotSyncSection';
import WalletSection from '../Wallet/WalletSection';
import KeyActionModal from '../Vault/KeyActionModal';
import NavItem from '@components/NavItem/NavItem';
import { useVault } from '../../context/VaultContext';
import { useAccount } from '../../context/AccountContext';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.js';
import styles from './MenuOverlay.module.css';

interface MenuOverlayProps {
  visible: boolean;
  onClose: () => void;
  initialSection?: string | null;
}

interface MenuItem {
  id: string;
  label: string;
  desc?: string;
  icon: ReactNode;
}

interface SyncDetailItem {
  displayName: string;
  isActive: boolean;
  accountId: string;
  stats: any | null;
  pubkey?: string;
}

interface Language {
  code: string;
  flag: string;
  native: string;
  prompt: string;
}

export default function MenuOverlay({ visible, onClose, initialSection }: MenuOverlayProps) {
  const [navStack, setNavStack] = useState<string[]>([]);
  const [keyAction, setKeyAction] = useState<string | null>(null); // 'nsec' | 'ncryptsec' | 'changePassword'
  const [langModalOpen, setLangModalOpen] = useState<boolean>(false);
  const [langSelected, setLangSelected] = useState<Language | null>(null);
  const [syncDetailItem, setSyncDetailItem] = useState<SyncDetailItem | null>(null);
  const [badgeDetailDomain, setBadgeDetailDomain] = useState<string | null>(null);
  const [permDetailDomain, setPermDetailDomain] = useState<string | null>(null);
  const permsSectionRef = useRef<any>(null);
  const vault = useVault();
  const { isReadOnly, isNip46, active } = useAccount();
  const { shouldRender, animating } = useAnimatedVisible(visible);
  const languages: Language[] = getSupportedLanguages();

  useEffect(() => {
    if (visible && initialSection) {
      setNavStack([initialSection]);
    } else if (!visible) {
      setNavStack([]);
    }
  }, [visible, initialSection]);

  const menuItems: MenuItem[] = [
    {
      id: 'security',
      label: t('settings.security'),
      desc: t('settings.securityDesc'),
      icon: <IconLock />,
    },
    {
      id: 'site-permissions',
      label: t('security.permissions'),
      desc: t('security.permissionsDesc'),
      icon: <IconShield />,
    },
    {
      id: 'wallet',
      label: t('wallet.title'),
      desc: t('wallet.connectHint'),
      icon: <IconZap />,
    },
    {
      id: 'wot',
      label: t('settings.webOfTrust'),
      desc: t('settings.webOfTrustDesc'),
      icon: <IconUsers />,
    },
    {
      id: 'network',
      label: t('settings.network'),
      desc: undefined,
      icon: <IconGlobe />,
    },
  ];

  const sectionTitles: Record<string, string> = {
    security: t('settings.security'),
    wot: t('settings.webOfTrust'),
    network: t('settings.network'),
    wallet: t('wallet.title'),
    'site-permissions': permDetailDomain || t('security.permissions'),
    'wot-injection': t('wot.badges'),
    'badge-detail': badgeDetailDomain || t('wot.badges'),
    databases: t('wot.sync'),
    'db-detail': syncDetailItem
      ? (syncDetailItem.displayName + (syncDetailItem.isActive ? ` \u00b7 ${t('sync.active')}` : ''))
      : t('wot.sync'),
  };

  if (!shouldRender) return null;

  const currentSection = navStack[navStack.length - 1] || null;
  const title = currentSection ? (sectionTitles[currentSection] || t('settings.title')) : t('settings.title');

  const pushSection = (id: string) => setNavStack((s) => [...s, id]);
  const popSection = () => {
    // Let child sections handle back internally first
    if (currentSection === 'site-permissions' && permsSectionRef.current?.goBack()) return;
    // If we're at the initial deep-linked section, close the entire overlay
    if (initialSection && navStack.length === 1 && navStack[0] === initialSection) {
      handleClose();
      return;
    }
    setNavStack((s) => s.slice(0, -1));
  };
  const handleClose = () => { setNavStack([]); onClose(); };

  const handleMenuItem = (id: string) => {
    pushSection(id);
  };

  const openLangPicker = () => {
    const current = getLanguage();
    const idx = languages.findIndex((l: Language) => l.code === current);
    setLangSelected(languages[idx >= 0 ? idx : 0]);
    setLangModalOpen(true);
  };

  const handleLangConfirm = async () => {
    if (langSelected) {
      await setLanguage(langSelected.code);
    }
    setLangModalOpen(false);
  };

  const currentLang = languages.find((l: Language) => l.code === getLanguage()) || languages[0];

  const renderSection = (): ReactNode => {
    switch (currentSection) {
      case 'security':
        return (
          <MenuSection>
            <SecuritySection
              onChangePassword={() => setKeyAction('changePassword')}
            />
            {!isReadOnly && active?.type !== 'nip46' && (
              <>
                <NavItem
                  icon={<IconKey />}
                  label={t('key.exportNsec')}
                  desc={t('key.exportNsecDesc')}
                  onClick={() => setKeyAction('nsec')}
                />
                <NavItem
                  icon={<IconLock />}
                  label={t('key.exportNcryptsec')}
                  desc={t('key.exportNcryptsecDesc')}
                  onClick={() => setKeyAction('ncryptsec')}
                />
                {vault.isGenerated && (
                  <NavItem
                    icon={<IconDownload />}
                    label={t('key.exportSeed')}
                    desc={t('key.exportSeedDesc')}
                    onClick={() => setKeyAction('seed')}
                  />
                )}
              </>
            )}
          </MenuSection>
        );
      case 'site-permissions':
        return <PermissionsSection ref={permsSectionRef} onDetailChange={setPermDetailDomain} />;
      case 'wallet':
        return <WalletSection />;
      case 'wot':
        return (
          <WotModeSection
            onSync={() => pushSection('databases')}
            onBadges={() => pushSection('wot-injection')}
          />
        );
      case 'databases':
        return <WotSyncSection onOpenDetail={(item: SyncDetailItem) => { setSyncDetailItem(item); pushSection('db-detail'); }} />;
      case 'db-detail':
        return syncDetailItem ? <WotSyncDetail item={syncDetailItem} onBack={popSection} /> : null;
      case 'wot-injection':
        return <WotInjectionSection onOpenDetail={(domain: string) => { setBadgeDetailDomain(domain); pushSection('badge-detail'); }} />;
      case 'badge-detail':
        return badgeDetailDomain ? <WotInjectionDetail domain={badgeDetailDomain} onBack={popSection} /> : null;
      case 'network':
        return <NetworkSection />;
      default:
        return null;
    }
  };

  return (
    <OverlayPanel
      title={title}
      onClose={handleClose}
      onBack={currentSection ? popSection : null}
      animating={animating}
    >
      <div className={styles.menuContent}>
        <div key={currentSection || '_root'} className={styles.sectionContent}>
          {!currentSection ? (
            <div className={styles.items}>
              {menuItems.map((item) => {
                if (item.id === 'nip46' && !vault.isNip46) return null;
                if (item.id === 'wallet' && (isReadOnly || isNip46 || vault.locked)) return null;
                return (
                  <NavItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    desc={item.desc}
                    onClick={() => handleMenuItem(item.id)}
                  />
                );
              })}
            </div>
          ) : (
            renderSection()
          )}
        </div>

        <div className={styles.menuFooter}>
          {!currentSection && (
            <button className={styles.langRow} onClick={openLangPicker}>
              <span className={styles.langFlag}>{currentLang.flag}</span>
              <span className={styles.langLabel}>{currentLang.native}</span>
              <svg className={styles.langChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          <div className={styles.aboutFooter}>
            <img src={iconBaseSvg} className={styles.aboutLogo} alt="" />
            <span className={styles.aboutName}>Nostr WoT Extension</span>
            <span className={styles.aboutVersion}>v{appVersion}</span>
          </div>
        </div>
      </div>

      {langModalOpen && (
        <div className={styles.langModal}>
          <div className={styles.langModalHeader}>
            <span className={styles.langModalTitle}>
              {langSelected?.prompt || languages[0].prompt}
            </span>
            <button
              className={styles.langModalClose}
              onClick={() => setLangModalOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className={styles.langModalWheel}>
            <ScrollWheelPicker
              items={languages}
              selectedIndex={langSelected ? languages.findIndex((l: Language) => l.code === langSelected.code) : 0}
              onChange={(i: number) => setLangSelected(languages[i])}
              renderItem={(lang: Language, _i: number, isActive: boolean) => (
                <div className={`${styles.langWheelItem} ${isActive ? styles.langWheelItemActive : ''}`}>
                  <span className={styles.langWheelFlag}>{lang.flag}</span>
                  <span className={styles.langWheelName}>{lang.native}</span>
                </div>
              )}
            />
          </div>

          <div className={styles.langModalBottom}>
            <Button onClick={handleLangConfirm}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}

      {keyAction && (
        <KeyActionModal
          action={keyAction}
          onClose={() => setKeyAction(null)}
        />
      )}
    </OverlayPanel>
  );
}
