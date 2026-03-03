import React, { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import QrCode from '@components/QrCode/QrCode';
import styles from './WizardOverlay.module.css';
import nip46Styles from './Nip46Step.module.css';

function isValidBunkerUrl(url: string): boolean {
  if (!url.startsWith('bunker://')) return false;
  try {
    const stripped = url.replace('bunker://', 'https://');
    const parsed = new URL(stripped);
    const pk = parsed.hostname || parsed.pathname.replace(/^\//, '');
    return /^[0-9a-f]{64}$/i.test(pk);
  } catch { return false; }
}

const POLL_INTERVAL = 2500;

type QrState = 'idle' | 'generating' | 'waiting' | 'connected' | 'expired';

interface Nip46StepProps {
  onNext: (account: any) => void;
}

export default function Nip46Step({ onNext }: Nip46StepProps) {
  const [tab, setTab] = useState<'qr' | 'bunker'>('qr');

  // QR tab state
  const [qrState, setQrState] = useState<QrState>('idle');
  const [nostrconnectUri, setNostrconnectUri] = useState<string>('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Bunker tab state
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Start QR session on mount
  const startQrSession = useCallback(async () => {
    setQrState('generating');
    setNostrconnectUri('');
    setSessionId(null);
    try {
      const result = await rpc<{ nostrconnectUri: string; sessionId: string }>('onboarding_initNostrConnect', {});
      setNostrconnectUri(result.nostrconnectUri);
      setSessionId(result.sessionId);
      sessionRef.current = result.sessionId;
      setQrState('waiting');
    } catch {
      setQrState('expired');
    }
  }, []);

  useEffect(() => {
    if (tab === 'qr' && qrState === 'idle') {
      startQrSession();
    }
  }, [tab, qrState, startQrSession]);

  // Poll for connection
  useEffect(() => {
    if (qrState !== 'waiting' || !sessionId) return;

    pollRef.current = setInterval(async () => {
      try {
        const result = await rpc<{ connected?: boolean; expired?: boolean; account?: any }>('onboarding_pollNostrConnect', { sessionId });
        if (result.connected) {
          clearInterval(pollRef.current!);
          setQrState('connected');
          onNext(result.account);
        } else if (result.expired) {
          clearInterval(pollRef.current!);
          setQrState('expired');
        }
      } catch {
        clearInterval(pollRef.current!);
        setQrState('expired');
      }
    }, POLL_INTERVAL);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [qrState, sessionId, onNext]);

  // Cleanup session on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        rpc('onboarding_cancelNostrConnect', { sessionId: sessionRef.current }).catch(() => {});
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(nostrconnectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleRetry = () => {
    setQrState('idle');
  };

  // Bunker URL handler
  const handleBunkerContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterBunkerUrl')); return; }
    if (!isValidBunkerUrl(val)) { setError(t('wizard.invalidBunkerUrl')); return; }

    setLoading(true);
    setError('');

    try {
      const result = await rpc<{ account: any }>('onboarding_connectNip46', { bunkerUrl: val });
      onNext(result.account);
    } catch (e: any) {
      setError(e.message || t('wizard.connectionFailed'));
    }
    setLoading(false);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.nip46Title')}</h2>
      <p className={styles.stepDesc}>{t('wizard.nip46Desc')}</p>

      {/* Tab bar */}
      <div className={nip46Styles.tabs}>
        <button
          className={`${nip46Styles.tab} ${tab === 'qr' ? nip46Styles.tabActive : ''}`}
          onClick={() => setTab('qr')}
        >
          {t('wizard.nip46QrTab')}
        </button>
        <button
          className={`${nip46Styles.tab} ${tab === 'bunker' ? nip46Styles.tabActive : ''}`}
          onClick={() => setTab('bunker')}
        >
          {t('wizard.nip46BunkerTab')}
        </button>
      </div>

      {/* QR tab */}
      {tab === 'qr' && (
        <div className={nip46Styles.qrTab}>
          {(qrState === 'waiting' || qrState === 'generating') && (
            <>
              <div className={nip46Styles.qrContainer}>
                {nostrconnectUri ? (
                  <QrCode value={nostrconnectUri} size={180} className={nip46Styles.qrCode} />
                ) : (
                  <div className={nip46Styles.qrPlaceholder}>
                    <div className={nip46Styles.spinner} />
                  </div>
                )}
              </div>
              <p className={nip46Styles.qrHint}>{t('wizard.nip46QrHint')}</p>
              {nostrconnectUri && (
                <button className={nip46Styles.copyBtn} onClick={handleCopy}>
                  {copied ? t('wizard.nip46UriCopied') : t('wizard.nip46CopyUri')}
                </button>
              )}
              <div className={nip46Styles.statusRow}>
                <div className={nip46Styles.spinnerSmall} />
                <span>{t('wizard.nip46Waiting')}</span>
              </div>
            </>
          )}

          {qrState === 'connected' && (
            <div className={nip46Styles.statusRow}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="8" fill="#16a34a"/>
                <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>{t('wizard.nip46Connected')}</span>
            </div>
          )}

          {qrState === 'expired' && (
            <div className={nip46Styles.expiredState}>
              <p className={nip46Styles.expiredText}>{t('wizard.nip46Expired')}</p>
              <Button onClick={handleRetry}>{t('wizard.nip46Retry')}</Button>
            </div>
          )}
        </div>
      )}

      {/* Bunker URL tab */}
      {tab === 'bunker' && (
        <div>
          <div className={styles.formGroup}>
            <label>{t('wizard.bunkerLabel')}</label>
            <Input
              mono
              placeholder={t('wizard.bunkerPlaceholder')}
              value={input}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setInput(e.target.value); setError(''); }}
            />
            <div className={styles.hint}>
              {t('wizard.bunkerHint')}
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.stepActions}>
            <Button onClick={handleBunkerContinue} disabled={!input.trim() || loading}>
              {loading ? t('wizard.connecting') : t('common.connect')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
