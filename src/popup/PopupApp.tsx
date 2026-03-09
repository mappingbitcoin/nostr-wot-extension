import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import '@shared/theme.css';
import styles from './PopupApp.module.css';
import { AccountProvider, useAccount } from './context/AccountContext';
import { VaultProvider, useVault } from './context/VaultContext';
import { ScoringProvider } from './context/ScoringContext';
import { PermissionsProvider } from './context/PermissionsContext';
import TopoBg from '@components/TopoBg/TopoBg';
import Splash from '@components/Splash/Splash';
import TopBar from './components/TopBar/TopBar';
import HomeTab from './components/Home/HomeTab';
import MenuOverlay from './components/Menu/MenuOverlay';
import FiltersModal from './components/Filters/FiltersModal';
import ActivityModal from './components/Activity/ActivityModal';
import ApprovalOverlay from './components/Approval/ApprovalOverlay';
import WizardOverlay from './components/Wizard/WizardOverlay';
import EditProfileOverlay from './components/EditProfile/EditProfileOverlay';
import ScoringModal from './components/Home/ScoringModal';
import PermissionsSection from './components/Settings/PermissionsSection';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import UnlockModal from './components/Vault/UnlockModal';
import { t } from '@lib/i18n.js';

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState<boolean>(true);
  const [unlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [unlockWaiters, setUnlockWaiters] = useState<any[]>([]);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [menuSection, setMenuSection] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState<boolean>(false);
  const [activityOpen, setActivityOpen] = useState<boolean>(false);
  const [activityDomain, setActivityDomain] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [editProfileOpen, setEditProfileOpen] = useState<boolean>(false);
  const [permsDomain, setPermsDomain] = useState<string | null>(null);
  const [scoringOpen, setScoringOpen] = useState<boolean>(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const account = useAccount();
  const vault = useVault();

  // Capture active tab screenshot for backdrop
  useEffect(() => {
    browser.tabs.captureVisibleTab(undefined as any, { format: 'jpeg', quality: 50 })
      .then((dataUrl: string) => setScreenshot(dataUrl))
      .catch(() => {}); // Fails on chrome:// pages etc — just skip
  }, []);

  // Dismiss splash after init
  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), 600);
    return () => clearTimeout(timer);
  }, []);

  // Show wizard if no accounts
  useEffect(() => {
    if (account.accounts !== null && account.accounts.length === 0) {
      setWizardOpen(true);
    }
  }, [account.accounts]);

  // Resume wizard if there's persisted mid-flow state (e.g. user closed popup during seed creation)
  useEffect(() => {
    browser.storage.session.get('wizardState')
      .then((data: Record<string, unknown>) => {
        const saved = data.wizardState as { step?: string; ts?: number } | undefined;
        if (saved?.step && saved?.ts && Date.now() - saved.ts < 5 * 60 * 1000) {
          setWizardOpen(true);
        }
      })
      .catch(() => {});
  }, []);

  // Unlock modal is shown only when:
  // 1. There are pending signer requests waiting for unlock (ApprovalOverlay)
  // 2. The user clicks the lock icon in TopBar

  const handleWizardComplete = () => {
    setWizardOpen(false);
    account.reload();
    rpcNotify('configUpdated');
  };

  return (
    <>
      {screenshot && (
        <div
          className={styles.backdrop}
          style={{ backgroundImage: `url(${screenshot})` }}
        />
      )}
      <TopoBg className={styles.card}>
        <Splash visible={splashVisible} />
        <TopBar
          onMenuOpen={() => setMenuOpen(true)}
          onAddAccount={() => setWizardOpen(true)}
          onEditProfile={() => setEditProfileOpen(true)}
          onRequestUnlock={() => setUnlockVisible(true)}
        />

        <div className={styles.scrollArea}>
          <HomeTab
            onViewAllActivity={(d: string | null) => { setActivityDomain(d || null); setActivityOpen(true); }}
            onManagePermissions={(domain: string) => setPermsDomain(domain)}
            onManageFilters={() => setFiltersOpen(true)}
            onManageBadges={() => { setMenuSection('wot-injection'); setMenuOpen(true); }}
            onEditProfile={() => setEditProfileOpen(true)}
            onManageScoring={() => setScoringOpen(true)}
            onOpenWallet={() => { setMenuSection('wallet'); setMenuOpen(true); }}
          />
        </div>

        <ApprovalOverlay
          onRequestUnlock={() => setUnlockVisible(true)}
          onUnlockWaitersChange={setUnlockWaiters}
        />

        <MenuOverlay
          visible={menuOpen}
          onClose={() => { setMenuOpen(false); setMenuSection(null); }}
          initialSection={menuSection}
        />

        <FiltersModal
          visible={filtersOpen}
          onClose={() => setFiltersOpen(false)}
        />

        <ActivityModal
          visible={activityOpen}
          initialDomain={activityDomain}
          initialPubkey={account.active?.pubkey || ''}
          onClose={() => { setActivityOpen(false); setActivityDomain(null); }}
        />

        <WizardOverlay
          visible={wizardOpen}
          canClose={account.accounts?.length! > 0}
          onClose={() => setWizardOpen(false)}
          onComplete={handleWizardComplete}
        />

        <EditProfileOverlay
          visible={editProfileOpen}
          onClose={() => setEditProfileOpen(false)}
        />

        {scoringOpen && (
          <ScoringModal onClose={() => setScoringOpen(false)} />
        )}

        {permsDomain && (
          <OverlayPanel
            title={t('security.permissions')}
            onClose={() => setPermsDomain(null)}
            onBack={() => setPermsDomain(null)}
            zIndex={300}
          >
            <PermissionsSection />
          </OverlayPanel>
        )}

        <UnlockModal
          visible={unlockVisible}
          unlockWaiters={unlockWaiters}
          onUnlocked={() => setUnlockVisible(false)}
          onCancel={() => setUnlockVisible(false)}
        />
      </TopoBg>
    </>
  );
}

export default function PopupApp() {
  return (
    <AccountProvider>
      <VaultProvider>
        <PermissionsProvider>
          <ScoringProvider>
            <PopupInner />
          </ScoringProvider>
        </PermissionsProvider>
      </VaultProvider>
    </AccountProvider>
  );
}
