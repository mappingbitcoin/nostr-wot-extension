import React, { useState, useCallback, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import WalletSetup from './WalletSetup';
import Wallet from './Wallet';

import styles from './Wallet.module.css';

/**
 * Wallet section for the settings menu.
 *
 * Checks `wallet_hasConfig` on mount — returns the provider type string
 * (truthy) or false. Shows WalletSetup or Wallet accordingly.
 */
export default function WalletSection() {
  // null = loading, false = no config, string = provider type
  const [configType, setConfigType] = useState<string | false | null>(null);

  const checkConfig = useCallback(async () => {
    try {
      const result = await rpc<string | false>('wallet_hasConfig');
      setConfigType(result || false);
    } catch {
      setConfigType(false);
    }
  }, []);

  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  if (configType === null) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
      </div>
    );
  }

  if (!configType) {
    return <WalletSetup onConnected={() => checkConfig()} />;
  }

  return <Wallet providerType={configType} onDisconnected={() => setConfigType(false)} />;
}
