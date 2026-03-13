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

interface WaiterInfo {
  id: string;
  type: string;
  origin: string;
  [key: string]: unknown;
}

type OverlayType = 'menu' | 'filters' | 'activity' | 'wizard' | 'editProfile' | 'scoring' | 'permissions' | null;

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState<boolean>(true);
  const [unlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [unlockWaiters, setUnlockWaiters] = useState<WaiterInfo[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [menuSection, setMenuSection] = useState<string | null>(null);
  const [activityDomain, setActivityDomain] = useState<string | null>(null);
  const [permsDomain, setPermsDomain] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const account = useAccount();
  const vault = useVault();

  // Capture active tab screenshot for backdrop
  useEffect(() => {
    browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 20 })
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
      setActiveOverlay('wizard');
    }
  }, [account.accounts]);

  // Resume wizard if there's persisted mid-flow state (e.g. user closed popup during seed creation)
  useEffect(() => {
    browser.storage.session.get('wizardState')
      .then((data: Record<string, unknown>) => {
        const saved = data.wizardState as { step?: string; ts?: number } | undefined;
        if (saved?.step && saved?.ts && Date.now() - saved.ts < 5 * 60 * 1000) {
          setActiveOverlay('wizard');
        }
      })
      .catch(() => {});
  }, []);

  // Unlock modal is shown only when:
  // 1. There are pending signer requests waiting for unlock (ApprovalOverlay)
  // 2. The user clicks the lock icon in TopBar

  const handleWizardComplete = () => {
    setActiveOverlay(null);
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
          onMenuOpen={() => setActiveOverlay('menu')}
          onAddAccount={() => setActiveOverlay('wizard')}
          onEditProfile={() => setActiveOverlay('editProfile')}
          onRequestUnlock={() => setUnlockVisible(true)}
        />

        <div className={styles.scrollArea}>
          <HomeTab
            onViewAllActivity={(d: string | null) => { setActivityDomain(d || null); setActiveOverlay('activity'); }}
            onManagePermissions={(domain: string) => { setPermsDomain(domain); setActiveOverlay('permissions'); }}
            onManageFilters={() => setActiveOverlay('filters')}
            onManageBadges={() => { setMenuSection('wot-injection'); setActiveOverlay('menu'); }}
            onEditProfile={() => setActiveOverlay('editProfile')}
            onManageScoring={() => setActiveOverlay('scoring')}
            onOpenWallet={() => { setMenuSection('wallet'); setActiveOverlay('menu'); }}
            menuOpen={activeOverlay === 'menu'}
          />
        </div>

        <ApprovalOverlay
          onRequestUnlock={() => setUnlockVisible(true)}
          onUnlockWaitersChange={setUnlockWaiters}
        />

        <MenuOverlay
          visible={activeOverlay === 'menu'}
          onClose={() => { setActiveOverlay(null); setMenuSection(null); }}
          initialSection={menuSection}
        />

        <FiltersModal
          visible={activeOverlay === 'filters'}
          onClose={() => setActiveOverlay(null)}
        />

        <ActivityModal
          visible={activeOverlay === 'activity'}
          initialDomain={activityDomain}
          initialPubkey={account.active?.pubkey || ''}
          onClose={() => { setActiveOverlay(null); setActivityDomain(null); }}
        />

        <WizardOverlay
          visible={activeOverlay === 'wizard'}
          canClose={(account.accounts?.length ?? 0) > 0}
          onClose={() => setActiveOverlay(null)}
          onComplete={handleWizardComplete}
        />

        <EditProfileOverlay
          visible={activeOverlay === 'editProfile'}
          onClose={() => setActiveOverlay(null)}
        />

        {activeOverlay === 'scoring' && (
          <ScoringModal onClose={() => setActiveOverlay(null)} />
        )}

        {activeOverlay === 'permissions' && permsDomain && (
          <OverlayPanel
            title={t('security.permissions')}
            onClose={() => { setActiveOverlay(null); setPermsDomain(null); }}
            onBack={() => { setActiveOverlay(null); setPermsDomain(null); }}
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
