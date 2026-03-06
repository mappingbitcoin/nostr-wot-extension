import React, { useState, useEffect, useCallback, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import QrCode from '@components/QrCode/QrCode';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';

import styles from './Wallet.module.css';

interface WalletProps {
  providerType: string;
  onDisconnected: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  nwc: 'Nostr Wallet Connect',
  lnbits: 'LNbits',
};

export default function Wallet({ providerType, onDisconnected }: WalletProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(true);
  const [balanceError, setBalanceError] = useState<string>('');
  const [threshold, setThreshold] = useState<number>(0);
  const [thresholdDraft, setThresholdDraft] = useState<string>('0');
  const [disconnecting, setDisconnecting] = useState<boolean>(false);

  // Deposit flow
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [depositLoading, setDepositLoading] = useState<boolean>(false);
  const [depositBolt11, setDepositBolt11] = useState<string>('');
  const [depositError, setDepositError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const result = await rpc<{ balance: number }>('wallet_getBalance');
      setBalance(result?.balance ?? 0);
    } catch (e: unknown) {
      setBalanceError((e as Error).message);
    }
    setBalanceLoading(false);
  }, []);

  const fetchThreshold = useCallback(async () => {
    try {
      const result = await rpc<number>('wallet_getAutoApproveThreshold');
      const val = typeof result === 'number' ? result : 0;
      setThreshold(val);
      setThresholdDraft(String(val));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBalance();
    fetchThreshold();
  }, [fetchBalance, fetchThreshold]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await rpc('wallet_disconnect');
      onDisconnected();
    } catch {
      setDisconnecting(false);
    }
  };

  const handleThresholdBlur = async () => {
    const val = Math.max(0, parseInt(thresholdDraft, 10) || 0);
    setThresholdDraft(String(val));
    if (val !== threshold) {
      setThreshold(val);
      await rpc('wallet_setAutoApproveThreshold', { threshold: val });
    }
  };

  const handleDeposit = async () => {
    const amount = parseInt(depositAmount, 10);
    if (!amount || amount <= 0) return;
    setDepositLoading(true);
    setDepositError('');
    setDepositBolt11('');
    try {
      const result = await rpc<{ bolt11: string; paymentHash: string }>(
        'wallet_makeInvoice',
        { amount, memo: 'Deposit' },
      );
      setDepositBolt11(result.bolt11);
    } catch (e: unknown) {
      setDepositError((e as Error).message);
    }
    setDepositLoading(false);
  };

  const handleCopyBolt11 = async () => {
    try {
      await navigator.clipboard.writeText(depositBolt11);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const closeDeposit = () => {
    setDepositBolt11('');
    setDepositAmount('');
    setDepositError('');
    fetchBalance();
  };

  const providerLabel = PROVIDER_LABELS[providerType] ?? providerType;

  return (
    <div className={styles.section}>
      {/* Provider info header */}
      <Card className={styles.providerCard}>
        <div className={styles.providerRow}>
          <div className={styles.providerInfo}>
            <span className={styles.providerLabel}>{providerLabel}</span>
            <span className={styles.providerStatus}>{t('wallet.connected')}</span>
          </div>
          <Button
            small
            variant="danger"
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? t('common.loading') : t('common.disconnect')}
          </Button>
        </div>
      </Card>

      {/* Balance */}
      <Card className={styles.balanceCard}>
        <span className={styles.balanceLabel}>{t('wallet.balance')}</span>
        {balanceLoading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
          </div>
        ) : balanceError ? (
          <div className={styles.balanceErrorWrap}>
            <div className={styles.error}>{balanceError}</div>
            <Button small variant="secondary" onClick={fetchBalance}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div>
            <span className={styles.balanceValue}>
              {(balance ?? 0).toLocaleString()}
            </span>
            <span className={styles.balanceUnit}>sats</span>
          </div>
        )}
      </Card>

      {/* Deposit section */}
      {!depositBolt11 && (
        <Card>
          <SectionLabel>{t('wallet.deposit')}</SectionLabel>
          <div className={styles.form}>
            <Input
              type="number"
              placeholder={t('wallet.amountSats')}
              value={depositAmount}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDepositAmount(e.target.value)}
              small
            />
            {depositError && <div className={styles.error}>{depositError}</div>}
            <div className={styles.formActions}>
              <Button
                small
                onClick={handleDeposit}
                disabled={depositLoading || !depositAmount || parseInt(depositAmount, 10) <= 0}
              >
                {depositLoading ? t('common.loading') : t('wallet.createInvoice')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* QR code overlay for bolt11 */}
      {depositBolt11 && (
        <div className={styles.qrOverlay} onClick={closeDeposit}>
          <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.qrTitle}>{t('wallet.payInvoice')}</div>
            <QrCode value={depositBolt11} size={200} className={styles.qrCode} />
            <div className={styles.qrBolt11} onClick={handleCopyBolt11}>
              {depositBolt11}
            </div>
            <div className={styles.qrActions}>
              <Button small variant="secondary" onClick={handleCopyBolt11}>
                {copied ? t('common.copied') : t('common.copy')}
              </Button>
              <Button small onClick={closeDeposit}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-approve threshold */}
      <Card>
        <SectionLabel>{t('wallet.autoApprove')}</SectionLabel>
        <SectionHint>{t('wallet.autoApproveHint')}</SectionHint>
        <div className={styles.thresholdRow}>
          <span className={styles.thresholdLabel}>{t('wallet.maxSats')}</span>
          <Input
            type="number"
            value={thresholdDraft}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setThresholdDraft(e.target.value)}
            onBlur={handleThresholdBlur}
            small
            className={styles.thresholdInput}
          />
        </div>
      </Card>
    </div>
  );
}
