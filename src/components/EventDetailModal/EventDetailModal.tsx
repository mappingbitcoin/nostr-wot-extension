import React, { useMemo, useState, useEffect } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.ts';
import { formatLabel } from '@shared/permissions.ts';
import { computeFollowDiff } from '@shared/activity.ts';
import { formatTime } from '@shared/format/time.ts';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import EventPreview from '@components/EventPreview/EventPreview';
import StatusDot from '@components/StatusDot/StatusDot';
import Button from '@components/Button/Button';
import styles from './EventDetailModal.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface ActivityEntry {
  method: string;
  event?: NostrEvent | null;
  theirPubkey?: string | null;
  decision?: string;
  timestamp?: number;
}

interface ActivityGroup {
  methodKey?: string;
  domain?: string;
  entries?: ActivityEntry[];
}

interface ApprovalRequest {
  type: string;
  permKey?: string;
  event?: NostrEvent | null;
  origin?: string;
  theirPubkey?: string | null;
  pubkey?: string;
}

interface FollowDiff {
  added: string[];
  removed: string[];
  unchangedCount: number;
}

function entryType(entry: ActivityEntry): string {
  if (entry.method === 'signEvent') return 'signEvent';
  if (entry.method === 'getPublicKey') return 'getPublicKey';
  return entry.method;
}

function entryFingerprint(entry: ActivityEntry): string {
  if (entry.event) return JSON.stringify(entry.event);
  return entry.theirPubkey || '';
}

interface EventDetailModalProps {
  // Activity mode
  group?: ActivityGroup | null;
  // Approval mode
  request?: ApprovalRequest | null;
  onApprove?: () => void;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  onAlwaysDeny?: () => void;
  // NIP-46 read-only mode
  nip46InFlight?: boolean;
  // Modal
  onClose?: () => void;
  onBack?: (() => void) | null;
  zIndex?: number;
}

/**
 * Unified event detail modal. Used for both activity detail and approval review.
 *
 * Activity mode: pass `group` with entries array. No action buttons.
 * Approval mode: pass `request` object + action callbacks. Shows approve/deny buttons.
 */
export default function EventDetailModal({
  // Activity mode
  group,
  // Approval mode
  request,
  onApprove,
  onDeny,
  onAlwaysAllow,
  onAlwaysDeny,
  // NIP-46 read-only mode
  nip46InFlight,
  // Modal
  onClose,
  onBack,
  zIndex = 350,
}: EventDetailModalProps) {
  const isApproval = !!request && !nip46InFlight;

  // Resolve display data from either group or request
  const type = isApproval ? request!.type : null;
  const permKey = isApproval ? (request!.permKey || request!.type) : group?.methodKey;
  const event = isApproval ? request!.event : group?.entries?.[0]?.event;
  const origin = isApproval ? request!.origin : group?.domain;
  const theirPubkey = isApproval ? request!.theirPubkey : group?.entries?.[0]?.theirPubkey;
  const entries = group?.entries || [];

  const title = formatLabel(permKey || '', event ?? undefined);

  // For activity: deduplicate entries by content
  const uniqueEntries = useMemo(() => {
    if (entries.length <= 1) return entries;
    const seen = new Set<string>();
    const unique: ActivityEntry[] = [];
    for (const entry of entries) {
      const fp = entryFingerprint(entry);
      if (!seen.has(fp)) {
        seen.add(fp);
        unique.push(entry);
      }
    }
    return unique;
  }, [entries]);

  const allIdentical = uniqueEntries.length <= 1;

  // Compute follow diff for kind 3 approval
  const [followDiff, setFollowDiff] = useState<FollowDiff | null>(null);
  useEffect(() => {
    if (!isApproval || event?.kind !== 3 || !event?.tags) return;
    rpc<string[]>('getFollows', { pubkey: request!.pubkey }).then((follows) => {
      setFollowDiff(computeFollowDiff(follows, event.tags!));
    }).catch(() => {});
  }, [isApproval, event?.kind, request?.pubkey]);

  // Approval description
  const description = isApproval ? describeRequest(request!, title) : null;

  return (
    <OverlayPanel
      title={isApproval ? t('approval.detail.title') : title}
      onBack={onBack}
      onClose={onClose}
      zIndex={zIndex}
    >
      <div className={styles.content}>
        {/* Origin / domain */}
        {origin && (
          <div className={styles.origin}>{origin}</div>
        )}

        {/* Approval: method badge + description */}
        {isApproval && (
          <div className={styles.summary}>
            <div className={styles.methodBadge}>{title}</div>
            {description && <p className={styles.description}>{description}</p>}
          </div>
        )}

        {/* Event content */}
        {isApproval ? (
          <EventPreview
            type={type}
            event={event || null}
            theirPubkey={theirPubkey}
            followDiff={followDiff}
          />
        ) : allIdentical ? (
          <>
            {entries.length > 0 && (
              <EventPreview
                type={entryType(entries[0])}
                event={entries[0].event || null}
                theirPubkey={entries[0].theirPubkey || null}
              />
            )}
            {entries.length > 1 && (
              <div className={styles.countNote}>
                &times;{entries.length} {t('activity.requests', { count: entries.length })}
              </div>
            )}
          </>
        ) : (
          uniqueEntries.map((entry, i) => (
            <div key={i} className={styles.entryBlock}>
              <div className={styles.entryHeader}>
                <StatusDot status={entry.decision || ''} />
                <span className={styles.entryTime}>{formatTime(entry.timestamp ?? 0)}</span>
              </div>
              <EventPreview
                type={entryType(entry)}
                event={entry.event || null}
                theirPubkey={entry.theirPubkey || null}
              />
            </div>
          ))
        )}

        {/* NIP-46 in-flight: read-only pending message */}
        {nip46InFlight && request && (
          <div className={styles.nip46Pending}>
            <div className={styles.nip46Spinner} />
            <span>{t('approval.pendingSignature')}</span>
          </div>
        )}

        {/* Approval action buttons */}
        {isApproval && (
          <div className={styles.actions}>
            <div className={styles.actionsRow}>
              <Button variant="danger" small onClick={onAlwaysDeny}>
                {t('approval.alwaysDenyLabel', { label: title })}
              </Button>
              <Button variant="secondary" small onClick={onDeny}>
                {t('approval.deny')}
              </Button>
            </div>
            <div className={styles.actionsRow}>
              <Button variant="secondary" small onClick={onAlwaysAllow}>
                {t('approval.alwaysAllowLabel', { label: title })}
              </Button>
              <Button small onClick={onApprove}>
                {t('approval.allow')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </OverlayPanel>
  );
}

function describeRequest(req: ApprovalRequest, label: string): string | null {
  const origin = req.origin || '?';
  switch (req.type) {
    case 'getPublicKey':
      return t('approval.detail.readProfileDesc', { origin });
    case 'signEvent':
      return t('approval.detail.signDesc', { origin, label: label || 'sign an event' });
    case 'nip04Encrypt':
    case 'nip44Encrypt':
      return t('approval.detail.sendDesc', { origin });
    case 'nip04Decrypt':
    case 'nip44Decrypt':
      return t('approval.detail.readDesc', { origin });
    default:
      return null;
  }
}
