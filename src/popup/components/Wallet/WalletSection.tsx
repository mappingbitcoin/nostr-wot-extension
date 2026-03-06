import React, { useState, useCallback, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import WalletSetup from './WalletSetup';
import Wallet from './Wallet';

import styles from './Wallet.module.css';

/**
 * Wallet section for the settings menu.
 *
 * Checks `wallet_hasConfig` on mount to decide between
 * showing WalletSetup (connect form) or Wallet (status display).
 */
export default function WalletSection() {
  const [hasConfig, setHasConfig] = useState<boolean | null>(null);

  const checkConfig = useCallback(async () => {
    try {
      const result = await rpc<boolean>('wallet_hasConfig');
      setHasConfig(!!result);
    } catch {
      setHasConfig(false);
    }
  }, []);

  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  if (hasConfig === null) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (!hasConfig) {
    return <WalletSetup onConnected={() => setHasConfig(true)} />;
  }

  return <Wallet onDisconnected={() => setHasConfig(false)} />;
}
