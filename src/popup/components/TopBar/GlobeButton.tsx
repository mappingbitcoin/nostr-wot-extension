import React, { useState, useEffect, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { getClientIconUrl } from '@shared/clientIcons.ts';
import { IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import styles from './TopBar.module.css';

export default function GlobeButton() {
  const [domain, setDomain] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [disconnecting, setDisconnecting] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function check() {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) {
          const url = new URL(tab.url);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            setDomain(url.hostname);
            const hasPermission = await browser.permissions.contains({
              origins: [`*://${url.hostname}/*`],
            });
            setConnected(hasPermission);
          }
        }
      } catch {
        // No access to tabs
      }
    }
    check();
  }, []);

  useEffect(() => {
    function handleClick(e: globalThis.MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  const handleConnect = async () => {
    if (!domain) return;
    try {
      const granted = await browser.permissions.request({ origins: [`*://${domain}/*`] });
      if (!granted) return;
      await rpc('addAllowedDomain', { domain });
      setConnected(true);
      rpcNotify('configUpdated');
    } catch {
      // denied
    }
  };

  const handleDisconnect = async () => {
    if (!domain) return;
    setDisconnecting(true);
    try {
      await rpc('removeAllowedDomain', { domain });
      await browser.permissions.remove({ origins: [`*://${domain}/*`] }).catch(() => {});
      setConnected(false);
      setOpen(false);
      rpcNotify('configUpdated');
    } catch {
      // failed
    } finally {
      setDisconnecting(false);
    }
  };

  const iconUrl = domain ? getClientIconUrl(domain) : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className={styles.globeBtn}
        title={t('topbar.siteConnection')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlobe size={16} />
        <span className={`${styles.globeDot} ${connected ? styles.globeConnected : styles.globeDisconnected}`} />
      </button>

      {open && (
        <div className={styles.globePopover}>
          {iconUrl && (
            <img src={iconUrl} alt={domain!} className={styles.clientIconLarge} />
          )}
          <div className={styles.globeDomain}>{domain || '—'}</div>
          <div className={styles.globeStatus}>
            {connected ? t('globe.connected') : t('globe.notConnected')}
          </div>
          {connected && domain && (
            <Button
              variant="danger"
              small
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{ width: '100%' }}
            >
              {disconnecting ? t('common.loading') : t('common.disconnect')}
            </Button>
          )}
          {!connected && domain && (
            <Button small onClick={handleConnect} style={{ width: '100%' }}>
              {t('common.connect')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
