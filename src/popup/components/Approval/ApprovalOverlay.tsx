import React, { useState, useEffect, useCallback } from 'react';
import browser from '@shared/browser.js';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { getDomainFromUrl } from '@shared/url.js';
import ApprovalCard from './ApprovalCard';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import { useVault } from '../../context/VaultContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useAccount } from '../../context/AccountContext';
import styles from './ApprovalOverlay.module.css';

interface ApprovalOverlayProps {
  onRequestUnlock?: () => void;
}

interface PendingRequest {
  id: string;
  origin: string;
  type: string;
  permKey?: string;
  needsPermission?: boolean;
  nip46InFlight?: boolean;
  waitingForUnlock?: boolean;
  accountId?: string;
  event?: any;
  [key: string]: any;
}

interface ApprovalGroup {
  origin: string;
  method: string;
  permKey: string;
  nip46InFlight?: boolean;
  requests: PendingRequest[];
}

export default function ApprovalOverlay({ onRequestUnlock }: ApprovalOverlayProps) {
  const [groups, setGroups] = useState<ApprovalGroup[]>([]);
  const [nip46Groups, setNip46Groups] = useState<ApprovalGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ApprovalGroup | null>(null);
  const [selectedNip46, setSelectedNip46] = useState<ApprovalGroup | null>(null);
  const vault = useVault();
  const permissions = usePermissions();
  const { active, accounts } = useAccount();

  const refresh = useCallback(async () => {
    let currentDomain: string | null = null;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) currentDomain = getDomainFromUrl(tab.url);
    } catch { /* ignore */ }

    const pending: PendingRequest[] = await rpc('signer_getPending') || [];

    const filtered = currentDomain
      ? pending.filter((r) => r.origin === currentDomain)
      : pending;

    const actionable = filtered.filter((r) => r.needsPermission && !r.nip46InFlight);
    const nip46InFlight = filtered.filter((r) => r.nip46InFlight);
    const unlockWaiters = filtered.filter((r) => r.waitingForUnlock);

    if (unlockWaiters.length > 0 && vault.locked) {
      onRequestUnlock?.();
    }

    // Group actionable requests
    const groupMap = new Map<string, ApprovalGroup>();
    for (const req of actionable) {
      const groupKey = req.permKey || req.type;
      const key = `${req.origin}::${groupKey}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          origin: req.origin,
          method: req.type,
          permKey: groupKey,
          requests: [],
        });
      }
      groupMap.get(key)!.requests.push(req);
    }

    // Group NIP-46 in-flight requests
    const nip46Map = new Map<string, ApprovalGroup>();
    for (const req of nip46InFlight) {
      const key = `${req.origin}::${req.type}`;
      if (!nip46Map.has(key)) {
        nip46Map.set(key, {
          origin: req.origin,
          method: req.type,
          permKey: req.type,
          nip46InFlight: true,
          requests: [],
        });
      }
      nip46Map.get(key)!.requests.push(req);
    }

    setGroups([...groupMap.values()]);
    setNip46Groups([...nip46Map.values()]);
  }, [vault.locked, onRequestUnlock]);

  useEffect(() => {
    refresh();

    const listener = (message: any) => {
      if (message.type === 'signerPendingUpdated') refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  const closeAndRefresh = () => {
    setSelectedGroup(null);
    setSelectedNip46(null);
    refresh();
  };

  const handleApprove = async (group: ApprovalGroup) => {
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
    }
    closeAndRefresh();
  };

  const handleAlwaysAllow = async (group: ApprovalGroup) => {
    const accountId = group.requests[0]?.accountId || active?.id || null;
    await permissions.savePermission(group.origin, group.permKey, 'allow', accountId);
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
    }
    closeAndRefresh();
  };

  const handleDeny = async (group: ApprovalGroup) => {
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
    }
    closeAndRefresh();
  };

  const handleAlwaysDeny = async (group: ApprovalGroup) => {
    const accountId = group.requests[0]?.accountId || active?.id || null;
    await permissions.savePermission(group.origin, group.permKey, 'deny', accountId);
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
    }
    closeAndRefresh();
  };

  if (groups.length === 0 && nip46Groups.length === 0) return null;

  return (
    <>
      <div className={styles.overlay}>
        <div className={styles.header}>
          <span className={styles.title}>{t('approval.pendingRequests')}</span>
          {groups.length > 0 && (
            <span className={styles.count}>{groups.reduce((n, g) => n + g.requests.length, 0)}</span>
          )}
        </div>
        {groups.length > 0 && permissions.useGlobalDefaults && accounts && accounts.length > 1 && (
          <div className={styles.legend}>
            {t('approval.appliesToAllAccounts')}
          </div>
        )}
        <div className={styles.list}>
          {groups.map((group) => (
            <ApprovalCard
              key={`${group.origin}::${group.permKey}`}
              group={group}
              onClick={() => setSelectedGroup(group)}
            />
          ))}
          {nip46Groups.map((group) => (
            <ApprovalCard
              key={`nip46::${group.origin}::${group.method}`}
              group={group}
              onClick={() => setSelectedNip46(group)}
            />
          ))}
        </div>
      </div>

      {selectedGroup && (
        <EventDetailModal
          request={selectedGroup.requests[0]}
          onApprove={() => handleApprove(selectedGroup)}
          onAlwaysAllow={() => handleAlwaysAllow(selectedGroup)}
          onDeny={() => handleDeny(selectedGroup)}
          onAlwaysDeny={() => handleAlwaysDeny(selectedGroup)}
          onClose={() => setSelectedGroup(null)}
        />
      )}

      {selectedNip46 && (
        <EventDetailModal
          request={selectedNip46.requests[0]}
          nip46InFlight
          onClose={() => setSelectedNip46(null)}
        />
      )}
    </>
  );
}
