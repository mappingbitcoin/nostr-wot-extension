import React, { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';

import styles from './Wallet.module.css';

interface WalletSetupProps {
  onConnected: () => void;
}

type ProviderTab = 'quick' | 'nwc' | 'lnbits';

export default function WalletSetup({ onConnected }: WalletSetupProps) {
  const [tab, setTab] = useState<ProviderTab>('quick');
  const [nwcString, setNwcString] = useState<string>('');
  const [lnbitsUrl, setLnbitsUrl] = useState<string>('');
  const [lnbitsKey, setLnbitsKey] = useState<string>('');
  const [provisionUrl, setProvisionUrl] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleConnect = async () => {
    setError('');
    setLoading(true);
    try {
      if (tab === 'quick') {
        await rpc('wallet_provision', {
          instanceUrl: provisionUrl.trim() || undefined,
        });
      } else if (tab === 'nwc') {
        const trimmed = nwcString.trim();
        if (!trimmed.startsWith('nostr+walletconnect://')) {
          setError(t('wallet.invalidNwc'));
          setLoading(false);
          return;
        }
        await rpc('wallet_connect', {
          walletConfig: { type: 'nwc', connectionString: trimmed },
        });
      } else {
        const url = lnbitsUrl.trim();
        const key = lnbitsKey.trim();
        if (!url || !key) {
          setError(t('wallet.fillAllFields'));
          setLoading(false);
          return;
        }
        await rpc('wallet_connect', {
          walletConfig: { type: 'lnbits', instanceUrl: url, adminKey: key },
        });
      }
      onConnected();
    } catch (e: unknown) {
      setError((e as Error).message || t('common.error'));
    }
    setLoading(false);
  };

  const nwcReady = nwcString.trim().length > 0;
  const lnbitsReady = lnbitsUrl.trim().length > 0 && lnbitsKey.trim().length > 0;
  const canConnect =
    tab === 'quick' ? true :
    tab === 'nwc' ? nwcReady :
    lnbitsReady;

  return (
    <div className={styles.section}>
      <Card>
        <SectionLabel>{t('wallet.connectWallet')}</SectionLabel>
        <SectionHint>{t('wallet.connectHint')}</SectionHint>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'quick' ? styles.tabActive : ''}`}
            onClick={() => { setTab('quick'); setError(''); }}
          >
            {t('wallet.quickSetup')}
          </button>
          <button
            className={`${styles.tab} ${tab === 'nwc' ? styles.tabActive : ''}`}
            onClick={() => { setTab('nwc'); setError(''); }}
          >
            NWC
          </button>
          <button
            className={`${styles.tab} ${tab === 'lnbits' ? styles.tabActive : ''}`}
            onClick={() => { setTab('lnbits'); setError(''); }}
          >
            LNbits
          </button>
        </div>

        <div className={styles.form}>
          {tab === 'quick' ? (
            <>
              <SectionHint>{t('wallet.quickSetupHint')}</SectionHint>
              <button
                className={styles.advancedToggle}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {t('wallet.advancedSettings')} {showAdvanced ? '\u25B2' : '\u25BC'}
              </button>
              {showAdvanced && (
                <Input
                  type="text"
                  placeholder="https://zaps.nostr-wot.com"
                  value={provisionUrl}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => { setProvisionUrl(e.target.value); setError(''); }}
                  label={t('wallet.lnbitsUrl')}
                />
              )}
            </>
          ) : tab === 'nwc' ? (
            <Input
              type="text"
              mono
              placeholder="nostr+walletconnect://..."
              value={nwcString}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setNwcString(e.target.value); setError(''); }}
            />
          ) : (
            <>
              <Input
                type="text"
                placeholder="https://lnbits.example.com"
                value={lnbitsUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setLnbitsUrl(e.target.value); setError(''); }}
                label={t('wallet.instanceUrl')}
              />
              <Input
                type="password"
                showToggle
                placeholder={t('wallet.adminKey')}
                value={lnbitsKey}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setLnbitsKey(e.target.value); setError(''); }}
                label={t('wallet.adminKey')}
              />
            </>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.formActions}>
            <Button small onClick={handleConnect} disabled={loading || !canConnect}>
              {loading ? t('common.loading') : tab === 'quick' ? t('wallet.createWallet') : t('common.connect')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
