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
  const [selectedRequest, setSelectedRequest] = useState<PendingRequest | null>(null);
  const [selectedNip46, setSelectedNip46] = useState<ApprovalGroup | null>(null);
  const [expanded, setExpanded] = useState(false);
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
    setSelectedRequest(null);
    setSelectedNip46(null);
    refresh();
  };

  // --- Group actions ---

  const handleApprove = async (group: ApprovalGroup) => {
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
    }
    closeAndRefresh();
  };

  const handleAlwaysAllow = async (group: ApprovalGroup) => {
    const accountId = group.requests[0]?.accountId || active?.id || null;
    await permissions.savePermission(group.origin, group.permKey, 'allow', accountId);
    const eventKind = group.requests[0]?.eventKind as number | undefined;
    await rpc('signer_resolveBatch', {
      origin: group.origin,
      method: group.method,
      decision: { allow: true, remember: false },
      eventKind,
    });
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
    const eventKind = group.requests[0]?.eventKind as number | undefined;
    await rpc('signer_resolveBatch', {
      origin: group.origin,
      method: group.method,
      decision: { allow: false, remember: false },
      eventKind,
    });
    closeAndRefresh();
  };

  // --- Single request actions (expanded mode) ---

  const handleApproveSingle = async (req: PendingRequest) => {
    await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
    closeAndRefresh();
  };

  const handleDenySingle = async (req: PendingRequest) => {
    await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
    closeAndRefresh();
  };

  const handleAlwaysAllowSingle = async (req: PendingRequest) => {
    const accountId = req.accountId || active?.id || null;
    const permKey = req.permKey || req.type;
    await permissions.savePermission(req.origin, permKey, 'allow', accountId);
    const eventKind = req.eventKind as number | undefined;
    await rpc('signer_resolveBatch', {
      origin: req.origin,
      method: req.type,
      decision: { allow: true, remember: false },
      eventKind,
    });
    closeAndRefresh();
  };

  const handleAlwaysDenySingle = async (req: PendingRequest) => {
    const accountId = req.accountId || active?.id || null;
    const permKey = req.permKey || req.type;
    await permissions.savePermission(req.origin, permKey, 'deny', accountId);
    const eventKind = req.eventKind as number | undefined;
    await rpc('signer_resolveBatch', {
      origin: req.origin,
      method: req.type,
      decision: { allow: false, remember: false },
      eventKind,
    });
    closeAndRefresh();
  };

  // --- Reject all ---

  const handleRejectAll = async () => {
    for (const group of groups) {
      for (const req of group.requests) {
        await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
      }
    }
    closeAndRefresh();
  };

  // All individual requests for expanded view
  const allRequests = groups.flatMap((g) => g.requests);

  if (groups.length === 0 && nip46Groups.length === 0) return null;

  const totalCount = groups.reduce((n, g) => n + g.requests.length, 0) + nip46Groups.reduce((n, g) => n + g.requests.length, 0);

  return (
    <>
      <div className={styles.scrim} />
      <div className={styles.overlay}>
        <div className={styles.header}>
          <span className={styles.title}>{t('approval.pendingRequests')}</span>
          <span className={styles.count}>{totalCount}</span>
          <div className={styles.headerActions}>
            {allRequests.length > 1 && (
              <button className={styles.toggleBtn} onClick={() => setExpanded(!expanded)}>
                {expanded ? t('approval.grouped') : t('approval.expanded')}
              </button>
            )}
            {groups.length > 0 && (
              <button className={styles.rejectAllBtn} onClick={handleRejectAll}>
                {t('approval.rejectAll')}
              </button>
            )}
          </div>
        </div>
        {groups.length > 0 && permissions.useGlobalDefaults && accounts && accounts.length > 1 && (
          <div className={styles.legend}>
            {t('approval.appliesToAllAccounts')}
          </div>
        )}
        <div className={styles.list}>
          {expanded ? (
            allRequests.map((req) => (
              <ApprovalCard
                key={req.id}
                group={{ origin: req.origin, method: req.type, permKey: req.permKey || req.type, requests: [req] }}
                onClick={() => setSelectedRequest(req)}
              />
            ))
          ) : (
            groups.map((group) => (
              <ApprovalCard
                key={`${group.origin}::${group.permKey}`}
                group={group}
                onClick={() => setSelectedGroup(group)}
              />
            ))
          )}
          {nip46Groups.map((group) => (
            <ApprovalCard
              key={`nip46::${group.origin}::${group.method}`}
              group={group}
              onCancel={async () => {
                for (const req of group.requests) {
                  await rpc('signer_cancelNip46', { id: req.id });
                }
                refresh();
              }}
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
          zIndex={510}
        />
      )}

      {selectedRequest && (
        <EventDetailModal
          request={selectedRequest}
          onApprove={() => handleApproveSingle(selectedRequest)}
          onAlwaysAllow={() => handleAlwaysAllowSingle(selectedRequest)}
          onDeny={() => handleDenySingle(selectedRequest)}
          onAlwaysDeny={() => handleAlwaysDenySingle(selectedRequest)}
          onClose={() => setSelectedRequest(null)}
          zIndex={510}
        />
      )}

      {selectedNip46 && (
        <EventDetailModal
          request={selectedNip46.requests[0]}
          nip46InFlight
          onDeny={async () => {
            for (const req of selectedNip46.requests) {
              await rpc('signer_cancelNip46', { id: req.id });
            }
            closeAndRefresh();
          }}
          onClose={() => setSelectedNip46(null)}
          zIndex={510}
        />
      )}
    </>
  );
}
