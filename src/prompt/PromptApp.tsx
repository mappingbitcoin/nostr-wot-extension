import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { computeFollowDiff } from '@shared/activity.ts';
import { formatLabel } from '@shared/permissions.ts';
import '@shared/theme.css';
import EventPreview from './components/EventPreview';
import DecisionRow from './components/DecisionRow';
import UnlockSection from './components/UnlockSection';
import styles from './PromptApp.module.css';

interface PromptDecision {
  allow: boolean;
  remember: boolean;
  duration?: number;
}

interface PendingPrompt {
  pubkey?: string;
  origin?: string;
  type?: string;
  event?: any;
  theirPubkey?: string;
  vaultLocked?: boolean;
  needsPermission?: boolean;
  walletAmount?: number;
}

interface FollowDiff {
  added: string[];
  removed: string[];
  unchangedCount: number;
}

export default function PromptApp() {
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [vaultLocked, setVaultLocked] = useState<boolean>(false);
  const [buttonsDisabled, setButtonsDisabled] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [followDiff, setFollowDiff] = useState<FollowDiff | null>(null);

  useEffect(() => {
    browser.storage.session.get(['pendingPrompt']).then((data: any) => {
      if (data.pendingPrompt) {
        setPrompt(data.pendingPrompt);
        setVaultLocked(data.pendingPrompt.vaultLocked || false);
        // Compute follow diff for kind 3
        const p = data.pendingPrompt;
        if (p.event?.kind === 3 && p.event?.tags && p.pubkey) {
          rpc<string[]>('getFollows', { pubkey: p.pubkey }).then((follows) => {
            setFollowDiff(computeFollowDiff(follows, p.event.tags));
          }).catch(() => {});
        }
      } else {
        setError(t('prompt.noPendingRequest'));
      }
      setLoading(false);
    }).catch(() => {
      setError(t('prompt.failedLoad'));
      setLoading(false);
    });
  }, []);

  const sendDecision = async (decision: PromptDecision) => {
    setButtonsDisabled(true);
    try {
      await rpc('prompt_decision', { decision });
      window.close();
    } catch {
      setButtonsDisabled(false);
    }
  };

  const handleDecision = async (decision: PromptDecision) => {
    if (vaultLocked && decision.allow) {
      return;
    }
    sendDecision(decision);
  };

  const handleUnlocked = () => {
    setVaultLocked(false);
  };

  if (loading) return <div className={styles.container}><div className={styles.loading}>{t('common.loading')}</div></div>;
  if (error) return <div className={styles.container}><div className={styles.error}>{error}</div></div>;
  if (!prompt) return null;

  const needsPermission = prompt.needsPermission !== false;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.accountBar}>
          <span className={styles.accountPubkey}>
            {prompt.pubkey?.slice(0, 8)}...{prompt.pubkey?.slice(-8)}
          </span>
        </div>
      </div>

      <div className={styles.originBar}>
        <span className={styles.originLabel}>{t('prompt.from')}</span>
        <span className={styles.originDomain}>{prompt.origin}</span>
      </div>

      {prompt.type?.startsWith('webln_') ? (
        <>
          <div className={styles.requestType}>
            {prompt.type === 'webln_sendPayment' ? 'Lightning Payment' : 'Lightning Request'}
          </div>
          {prompt.walletAmount !== undefined && prompt.walletAmount > 0 && (
            <div className={styles.paymentAmount}>
              {prompt.walletAmount.toLocaleString()} sats
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.requestType}>
            {formatLabel(prompt.type || '')}
          </div>

          <EventPreview
            type={prompt.type || null}
            event={prompt.event}
            theirPubkey={prompt.theirPubkey}
            followDiff={followDiff}
            className={styles.eventPreview}
          />
        </>
      )}

      {vaultLocked && (
        <UnlockSection onUnlocked={handleUnlocked} />
      )}

      {needsPermission ? (
        <DecisionRow
          disabled={buttonsDisabled || vaultLocked}
          onDecision={handleDecision}
        />
      ) : (
        <div className={styles.decisionRow}>
          <button
            className={`${styles.decisionBtn} ${styles.deny}`}
            disabled={buttonsDisabled}
            onClick={() => sendDecision({ allow: false, remember: false })}
          >
            {t('common.cancel')}
          </button>
          <button
            className={`${styles.decisionBtn} ${styles.always}`}
            disabled={buttonsDisabled || vaultLocked}
            onClick={() => sendDecision({ allow: true, remember: false })}
          >
            {vaultLocked ? t('prompt.unlockFirst') : t('common.continue')}
          </button>
        </div>
      )}
    </div>
  );
}
