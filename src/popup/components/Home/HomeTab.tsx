import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { getDomainFromUrl } from '@shared/url.ts';
import { t } from '@lib/i18n.js';
import { useAccount } from '../../context/AccountContext';
import SiteControls from './SiteControls';
import ProfileSuggestion from './ProfileSuggestion';
import SyncReminder from './SyncReminder';
import ScoringCard from './ScoringCard';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import EmptyState from '@components/EmptyState/EmptyState';
import { IconGlobe } from '@assets';
import styles from './HomeTab.module.css';

interface HomeTabProps {
  onViewAllActivity: (domain: string | null) => void;
  onManagePermissions: (domain: string) => void;
  onManageFilters: () => void;
  onManageBadges: () => void;
  onEditProfile: () => void;
}

interface SyncStaleInfo {
  lastSync: number | null;
  dismissed?: boolean;
}

export default function HomeTab({ onViewAllActivity, onManagePermissions, onManageFilters, onManageBadges, onEditProfile }: HomeTabProps) {
  const { active, cachedProfile, isReadOnly } = useAccount();
  const [domain, setDomain] = useState<string | null>(null);
  const [siteState, setSiteState] = useState<string | null>(null); // null = loading, 'empty' | 'notConnected' | 'connected'
  const [identityEnabled, setIdentityEnabled] = useState<boolean>(true);
  const [wotEnabled, setWotEnabled] = useState<boolean>(true);
  const [canInject, setCanInject] = useState<boolean>(false);
  const [syncStale, setSyncStale] = useState<SyncStaleInfo | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [profileDismissed, setProfileDismissed] = useState<boolean>(false);

  useEffect(() => {
    if (!active?.id) return;
    browser.storage.local.get('profileSuggestionDismissed').then((data) => {
      const dismissed = (data as Record<string, unknown>).profileSuggestionDismissed;
      const list: string[] = Array.isArray(dismissed) ? dismissed : [];
      setProfileDismissed(list.includes(active.id));
    });
  }, [active?.id]);

  useEffect(() => {
    loadHomeState();
  }, [active]);

  // Check if sync is stale (>24h) and poll sync-in-progress state
  useEffect(() => {
    if (!active?.id) { setSyncStale(null); setIsSyncing(false); return; }

    async function checkSync() {
      try {
        const [stats, syncState] = await Promise.all([
          rpc<{ lastSync?: number; nodes?: number }>('getDatabaseStats', { accountId: active!.id }),
          rpc<{ inProgress?: boolean }>('getSyncState'),
        ]);
        const syncing = !!(syncState?.inProgress);
        setIsSyncing(syncing);

        if (syncing) {
          // Don't show stale banner while syncing
          setSyncStale(null);
        } else {
          // Check if user dismissed the stale banner within the last 24h
          const dismissData = await browser.storage.local.get('syncStaleDismissed');
          const dismissed = (dismissData as Record<string, unknown>).syncStaleDismissed as Record<string, number> | undefined;
          const dismissedAt = dismissed?.[active!.id];
          const recentlyDismissed = dismissedAt && (Date.now() - dismissedAt < 24 * 60 * 60 * 1000);

          if (recentlyDismissed) {
            setSyncStale(null);
          } else {
            const lastSync = stats?.lastSync;
            if (!lastSync && (stats?.nodes ?? 0) === 0) {
              setSyncStale({ lastSync: null });
            } else if (lastSync && Date.now() - lastSync > 24 * 60 * 60 * 1000) {
              setSyncStale({ lastSync });
            } else {
              setSyncStale(null);
            }
          }
        }
      } catch {
        setSyncStale(null);
        setIsSyncing(false);
      }
    }

    checkSync();
    // Poll while popup is open so syncing indicator updates
    const interval = setInterval(checkSync, 3000);
    return () => clearInterval(interval);
  }, [active]);

  async function loadHomeState() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.url) {
        setSiteState('empty');
        return;
      }

      const d = getDomainFromUrl(tab.url);
      if (!d || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:') || tab.url.startsWith('moz-extension://') ||
          tab.url.startsWith('chrome-extension://')) {
        setSiteState('empty');
        return;
      }
      setDomain(d);

      const [allowedDomains, badgeDisabledData, identityDisabled, perms] = await Promise.all([
        rpc<string[]>('getAllowedDomains'),
        browser.storage.local.get('badgeDisabledSites') as Promise<any>,
        rpc<string[]>('getIdentityDisabledSites'),
        rpc<Record<string, string>>('signer_getPermissionsForDomain', { domain: d }),
      ]);

      const badgeDisabled = new Set<string>(badgeDisabledData.badgeDisabledSites || []);
      const identityDisabledSet = new Set<string>(identityDisabled || []);
      const inject = (allowedDomains || []).includes(d);
      const permObj = perms || {};
      const hp = Object.keys(permObj).length > 0;

      // If site has signer permissions but isn't in allowedDomains yet, add it
      if (hp && !inject) {
        rpc('addAllowedDomain', { domain: d }).catch(() => {});
      }

      setCanInject(inject || hp);
      setIdentityEnabled(!identityDisabledSet.has(d));
      setWotEnabled(!badgeDisabled.has(d));

      setSiteState(inject || hp ? 'connected' : 'notConnected');
    } catch {
      setSiteState('empty');
    }
  }

  const handleIdentityToggle = async (checked: boolean) => {
    setIdentityEnabled(checked);
    await rpc('setIdentityDisabled', { domain, disabled: !checked });
  };

  const handleWotToggle = async (checked: boolean) => {
    setWotEnabled(checked);
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!checked) {
      await rpc('setBadgeDisabled', { domain, disabled: true });
      if (tab) await rpc('removeBadgesFromTab', { tabId: tab.id });
    } else {
      await rpc('setBadgeDisabled', { domain, disabled: false });
      if (tab?.id) browser.tabs.reload(tab.id);
    }
  };

  const handleConnect = async () => {
    if (!domain) return;
    try {
      const granted = await browser.permissions.request({ origins: [`*://${domain}/*`] });
      if (!granted) return;
    } catch {
      return;
    }
    await Promise.all([
      rpc('addAllowedDomain', { domain }),
      rpc('setIdentityDisabled', { domain, disabled: false }),
      rpc('setBadgeDisabled', { domain, disabled: false }),
    ]);
    loadHomeState();
  };

  // Show profile suggestion if user has signing account but no kind 0
  const showProfileSuggestion = active && !isReadOnly && !cachedProfile?.name && !profileDismissed;

  const handleDismissProfile = async () => {
    if (!active?.id) return;
    setProfileDismissed(true);
    const data = await browser.storage.local.get('profileSuggestionDismissed');
    const dismissed = (data as Record<string, unknown>).profileSuggestionDismissed;
    const list: string[] = Array.isArray(dismissed) ? dismissed : [];
    if (!list.includes(active.id)) list.push(active.id);
    await browser.storage.local.set({ profileSuggestionDismissed: list });
  };

  const handleSyncNow = () => {
    rpcNotify('syncGraph', { depth: 3 });
    setSyncStale(null);
  };

  if (siteState === 'empty') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={t('home.navigateToConnect')}
            hint={t('home.siteControlsHint')}
          />
        </Card>
      </div>
    );
  }

  if (siteState === 'notConnected') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={domain!}
            hint={t('home.siteNotConnected')}
          >
            <Button small onClick={handleConnect}>{t('home.connectThisSite')}</Button>
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <>
      {showProfileSuggestion && <ProfileSuggestion onEdit={onEditProfile} onDismiss={handleDismissProfile} />}
      {isSyncing && (
        <SyncReminder syncing onDismiss={() => setIsSyncing(false)} />
      )}
      {!isSyncing && syncStale && (
        <SyncReminder
          lastSync={syncStale.lastSync}
          onSync={handleSyncNow}
          onDismiss={async () => {
            setSyncStale(null);
            if (!active?.id) return;
            const data = await browser.storage.local.get('syncStaleDismissed');
            const dismissed = ((data as Record<string, unknown>).syncStaleDismissed as Record<string, number> | undefined) || {};
            dismissed[active.id] = Date.now();
            await browser.storage.local.set({ syncStaleDismissed: dismissed });
          }}
        />
      )}
      <SiteControls
        identityEnabled={identityEnabled}
        wotEnabled={wotEnabled}
        canInject={canInject}
        onIdentityToggle={handleIdentityToggle}
        onWotToggle={handleWotToggle}
        onManagePermissions={() => onManagePermissions(domain!)}
        onManageFilters={onManageFilters}
        onManageBadges={onManageBadges}
        onRecentActivity={() => onViewAllActivity(domain)}
      >
        <ScoringCard />
      </SiteControls>
    </>
  );
}
