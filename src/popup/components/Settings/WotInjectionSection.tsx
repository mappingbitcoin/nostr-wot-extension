import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import browser from '@shared/browser.ts';
import { rpc, rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { getClientIconUrl, getFaviconUrl } from '@shared/clientIcons.ts';
import { getDefaultsForDomain, normalizeConfig, CSS_SKELETON, COMMON_SELECTORS } from '@shared/adapterDefaults.ts';
import Toggle from '@components/Toggle/Toggle';
import Button from '@components/Button/Button';
import Dropdown from '@components/Dropdown/Dropdown';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import { IconChevronRight } from '@assets';
import styles from './Settings.module.css';

const EXTRACT_PRESETS = ['href', 'data-npub', 'data-pubkey', 'data-user', 'text'];
const POSITION_OPTIONS = ['after', 'before', 'append'];

interface SiteIconProps {
  domain: string;
}

function SiteIcon({ domain }: SiteIconProps) {
  const [imgError, setImgError] = useState<boolean>(false);
  const clientUrl = getClientIconUrl(domain);
  const faviconUrl = getFaviconUrl(domain);
  const src = clientUrl || faviconUrl;

  if (imgError || !src) {
    return (
      <div className={styles.permFaviconFallback}>
        {domain.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className={styles.permFavicon}
      onError={() => setImgError(true)}
    />
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 4, display: 'block' };
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: 8, fontSize: 12, fontFamily: 'monospace',
  border: '1px solid var(--card-border)', borderRadius: 8,
  background: 'var(--bg)', color: 'var(--text-body)', resize: 'vertical',
};
const selectStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 12,
  border: '1px solid var(--card-border)', borderRadius: 8,
  background: 'var(--card-bg)', color: 'var(--text-body)',
};

interface Strategy {
  label: string;
  selectors: string;
  extractFrom: string;
  insertPosition: string;
  customCSS?: string;
  enabled?: boolean;
  conflictGroup?: string;
  [key: string]: any;
}

/* -- Strategy row (compact, whole row clickable) -- */
interface StrategyRowProps {
  strategy: Strategy;
  index: number;
  onChange: (updated: Strategy) => void;
  onEdit: () => void;
}

function StrategyRow({ strategy, index, onChange, onEdit }: StrategyRowProps) {
  const enabled = strategy.enabled !== false;
  const label = strategy.label || `${t('badges.strategy')} ${index + 1}`;

  return (
    <button
      type="button"
      onClick={onEdit}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', background: 'var(--card-bg)', border: '1px solid var(--card-border)',
        borderRadius: 10, cursor: 'pointer', opacity: enabled ? 1 : 0.5,
        transition: 'background 0.15s',
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div onClick={(e) => e.stopPropagation()} role="presentation">
        <Toggle
          checked={enabled}
          onChange={() => onChange({ ...strategy, enabled: !enabled })}
        />
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text-heading)', textAlign: 'left' }}>{label}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>&#9654;</span>
    </button>
  );
}

/* -- Strategy modal (OverlayPanel) -- */
interface StrategyModalProps {
  strategy: Strategy;
  index: number;
  domain: string;
  strategies: Strategy[];
  onChange: (updated: Strategy) => void;
  onRemove: () => void;
  onSave: () => void;
  onClose: () => void;
}

function StrategyModal({ strategy, index, domain, strategies, onChange, onRemove, onSave, onClose }: StrategyModalProps) {
  const [skeletonAdded, setSkeletonAdded] = useState<boolean>(false);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const selectorPickerRef = useRef<HTMLSelectElement>(null);
  const isCustomExtract = !EXTRACT_PRESETS.includes(strategy.extractFrom);

  const insertCssSkeleton = () => {
    if ((strategy.customCSS || '').includes('.wot-badge')) return;
    const css = strategy.customCSS ? strategy.customCSS + '\n\n' + CSS_SKELETON : CSS_SKELETON;
    onChange({ ...strategy, customCSS: css });
    setSkeletonAdded(true);
    setTimeout(() => setSkeletonAdded(false), 2000);
  };

  const handleSelectorPreset = (value: string) => {
    if (!value) return;
    const current = (strategy.selectors || '').trimEnd();
    const updated = current ? current + '\n' + value : value;
    onChange({ ...strategy, selectors: updated });
    if (selectorPickerRef.current) selectorPickerRef.current.selectedIndex = 0;
  };

  const handleExtractChange = (value: string) => {
    if (value === '__custom__') {
      onChange({ ...strategy, extractFrom: 'data-' });
    } else {
      onChange({ ...strategy, extractFrom: value });
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      // Build a temporary config with the current in-progress strategies
      const tempStrategies = strategies.map((s, i) => (i === index ? strategy : s));
      const config = { version: 2, strategies: tempStrategies };
      await rpc('previewBadgeConfig', { domain, config });
    } catch { /* ignore */ }
    setTimeout(() => setPreviewing(false), 1500);
  };

  const panel = (
    <OverlayPanel
      title={t('badges.editStrategy')}
      onBack={onClose}
      onClose={onClose}
      zIndex={400}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 2px', overflowY: 'auto' }}>
        <div>
          <label style={labelStyle}>{t('badges.strategyLabel')}</label>
          <input
            type="text"
            value={strategy.label}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...strategy, label: e.target.value })}
            placeholder={`${t('badges.strategy')} ${index + 1}`}
            style={{ ...selectStyle, padding: '6px 8px' }}
          />
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>{t('badges.cssSelectors')}</label>
            <select
              ref={selectorPickerRef}
              defaultValue=""
              onChange={(e: ChangeEvent<HTMLSelectElement>) => handleSelectorPreset(e.target.value)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                border: '1px solid var(--card-border)', background: 'var(--card-bg)',
                color: 'var(--brand)', cursor: 'pointer',
              }}
            >
              <option value="" disabled>+ {t('badges.commonSelectors')}</option>
              {COMMON_SELECTORS.map((cs: any) => (
                <option key={cs.value} value={cs.value}>{cs.label}</option>
              ))}
            </select>
          </div>
          <textarea
            value={strategy.selectors}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...strategy, selectors: e.target.value })}
            placeholder={'a[href*="npub1"]\n[data-npub]'}
            rows={3}
            style={textareaStyle}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('badges.cssSelectorsHint')}</span>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('badges.extractFrom')}</label>
            <select
              value={isCustomExtract ? '__custom__' : strategy.extractFrom}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => handleExtractChange(e.target.value)}
              style={selectStyle}
            >
              {EXTRACT_PRESETS.map((o) => <option key={o} value={o}>{o}</option>)}
              <option value="__custom__">custom...</option>
            </select>
            {isCustomExtract && (
              <input
                type="text"
                value={strategy.extractFrom}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...strategy, extractFrom: e.target.value })}
                placeholder="data-my-attr"
                style={{ ...selectStyle, padding: '6px 8px', marginTop: 4 }}
              />
            )}
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>{t('badges.badgePlacement')}</label>
            <select value={strategy.insertPosition} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ ...strategy, insertPosition: e.target.value })} style={selectStyle}>
              {POSITION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={labelStyle}>{t('badges.customCss')}</label>
            <button
              type="button"
              onClick={insertCssSkeleton}
              disabled={(strategy.customCSS || '').includes('.wot-badge')}
              style={{
                fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                border: '1px solid var(--card-border)', background: 'var(--card-bg)',
                color: skeletonAdded ? 'var(--success)' : 'var(--brand)', cursor: 'pointer',
                opacity: (strategy.customCSS || '').includes('.wot-badge') ? 0.5 : 1,
              }}
            >
              {skeletonAdded ? t('badges.cssSkeletonAdded') : t('badges.insertCssSkeleton')}
            </button>
          </div>
          <textarea
            value={strategy.customCSS || ''}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...strategy, customCSS: e.target.value })}
            placeholder={'.wot-badge { font-size: 10px; }'}
            rows={3}
            style={textareaStyle}
          />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('badges.customCssHint')}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={onRemove}
            style={{
              flex: 1, padding: '10px', borderRadius: 8,
              border: '1px solid rgba(220, 38, 38, 0.2)', background: 'rgba(220, 38, 38, 0.06)',
              color: 'var(--error)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {t('badges.removeStrategy')}
          </button>
          <Button variant="secondary" small style={{ flex: 1 }} onClick={handlePreview}>
            {previewing ? t('badges.previewing') : t('badges.preview')}
          </Button>
          <Button small style={{ flex: 1 }} onClick={onSave}>{t('common.save')}</Button>
        </div>
      </div>
    </OverlayPanel>
  );

  // Render via portal so the overlay covers the full popup, not just the parent container
  return createPortal(panel, document.getElementById('root') || document.body);
}

/* -- Detail sub-view for a single site -- */
interface WotInjectionDetailProps {
  domain: string;
  onBack: () => void;
}

export function WotInjectionDetail({ domain, onBack }: WotInjectionDetailProps) {
  const [strategies, setStrategies] = useState<Strategy[] | null>(null);
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [hasCustom, setHasCustom] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const adapters = await rpc<Record<string, any>>('getCustomAdapters');
        const raw = adapters?.[domain];
        if (raw) {
          setHasCustom(true);
          const cfg = normalizeConfig(raw);
          setStrategies(cfg.strategies.length > 0 ? cfg.strategies : []);
        } else {
          setHasCustom(false);
          setStrategies([]);
        }
      } catch {
        setStrategies([]);
      }
    })();
  }, [domain]);

  if (!strategies) return null;

  const updateStrategy = (idx: number, updated: Strategy) => {
    setStrategies((prev) => {
      if (!prev) return prev;
      const next = prev.map((s, i) => (i === idx ? updated : s));
      // Auto-save when toggle changes (enabled field only)
      if (prev[idx] && prev[idx].enabled !== updated.enabled) {
        persistStrategies(next);
      }
      return next;
    });
  };

  const removeStrategy = (idx: number) => {
    setStrategies((prev) => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== idx);
      persistStrategies(next);
      return next;
    });
    setEditingIdx(-1);
  };

  const persistStrategies = async (list?: Strategy[] | null) => {
    const all = list || strategies;
    if (!all) return;
    const config = { version: 2, strategies: all };
    const hasContent = all.length > 0;

    if (hasContent) {
      await rpc('saveCustomAdapter', { domain, config });
      setHasCustom(true);
    } else {
      await rpc('deleteCustomAdapter', { domain });
      setHasCustom(false);
    }
    rpcNotify('configUpdated');
  };

  const handleSaveStrategy = async () => {
    await persistStrategies(strategies);
    setEditingIdx(-1);
  };

  const templates = getDefaultsForDomain(domain);

  const addStrategyOptions = [
    ...templates.map((tpl: any, i: number) => ({
      value: String(i),
      label: tpl.label || `${t('badges.strategy')} ${i + 1}`,
    })),
    { value: 'custom', label: t('badges.customStrategy') },
  ];

  const handleAddStrategy = (value: string) => {
    if (!value) return;
    let newS: Strategy;
    if (value === 'custom') {
      newS = { label: '', selectors: '', extractFrom: 'href', insertPosition: 'after', customCSS: '' };
    } else {
      const idx = parseInt(value, 10);
      newS = structuredClone(templates[idx]);
    }
    setStrategies((prev) => {
      if (!prev) return prev;
      const next = [...prev, newS];
      persistStrategies(next);
      // Auto-enter edit mode for the new strategy
      setEditingIdx(next.length - 1);
      return next;
    });
  };

  const handleReset = async () => {
    await rpc('deleteCustomAdapter', { domain });
    setHasCustom(false);
    setStrategies([]);
    setEditingIdx(-1);
    rpcNotify('configUpdated');
  };

  // Detect conflict groups where multiple strategies are enabled
  const conflictWarnings = (() => {
    const groups: Record<string, string[]> = {};
    for (const s of strategies) {
      if (!s.conflictGroup || s.enabled === false) continue;
      if (!groups[s.conflictGroup]) groups[s.conflictGroup] = [];
      groups[s.conflictGroup].push(s.label || t('badges.strategy'));
    }
    return Object.values(groups).filter(arr => arr.length > 1);
  })();

  return (
    <div className={styles.section} style={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      <SectionHint>{t('badges.strategiesHint')}</SectionHint>

      {conflictWarnings.map((names, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8, marginBottom: 4,
            background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)',
            fontSize: 12, color: 'var(--text-body)',
          }}
        >
          <span style={{ fontSize: 14 }}>&#9888;</span>
          <span>{t('badges.conflictWarning', { strategies: names.join(', ') })}</span>
        </div>
      ))}

      {strategies.map((s, i) => (
        <StrategyRow
          key={i}
          strategy={s}
          index={i}
          onChange={(updated) => updateStrategy(i, updated)}
          onEdit={() => setEditingIdx(i)}
        />
      ))}

      {editingIdx >= 0 && editingIdx < strategies.length && (
        <StrategyModal
          strategy={strategies[editingIdx]}
          index={editingIdx}
          domain={domain}
          strategies={strategies}
          onChange={(updated) => updateStrategy(editingIdx, updated)}
          onRemove={() => removeStrategy(editingIdx)}
          onSave={handleSaveStrategy}
          onClose={() => setEditingIdx(-1)}
        />
      )}

      <Dropdown
        options={addStrategyOptions}
        value=""
        onChange={handleAddStrategy}
        placeholder={`+ ${t('badges.addStrategy')}`}
        small
      />

      {hasCustom && (
        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 4 }}>
          <Button variant="secondary" small onClick={handleReset}>{t('badges.resetDefaults')}</Button>
        </div>
      )}
    </div>
  );
}

/* -- List view -- */
interface WotInjectionSectionProps {
  onOpenDetail: (domain: string) => void;
}

export default function WotInjectionSection({ onOpenDetail }: WotInjectionSectionProps) {
  const [enabled, setEnabled] = useState<boolean>(true);
  const [disabledSites, setDisabledSites] = useState<string[]>([]);
  const [allSites, setAllSites] = useState<string[]>([]);
  const [customAdapters, setCustomAdapters] = useState<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      const syncData: any = await browser.storage.sync.get(['wotInjectionEnabled']);
      const localData: any = await browser.storage.local.get(['badgeDisabledSites']);

      setEnabled(syncData.wotInjectionEnabled !== false);
      setDisabledSites(localData.badgeDisabledSites || []);

      try {
        const [domains, adapters] = await Promise.all([
          rpc<string[]>('getAllowedDomains'),
          rpc<Record<string, any>>('getCustomAdapters'),
        ]);
        setAllSites(domains || []);
        setCustomAdapters(adapters || {});
      } catch { /* ignore */ }
    })();
  }, []);

  const handleGlobalToggle = async (val: boolean) => {
    setEnabled(val);
    await browser.storage.sync.set({ wotInjectionEnabled: val });
    rpcNotify('configUpdated');
  };

  const handleSiteToggle = async (domain: string) => {
    const isDisabled = disabledSites.includes(domain);
    const updated = isDisabled
      ? disabledSites.filter((d) => d !== domain)
      : [...disabledSites, domain];
    setDisabledSites(updated);
    await browser.storage.local.set({ badgeDisabledSites: updated });
    rpcNotify('configUpdated');
  };

  return (
    <div className={styles.section}>
      <div className={styles.toggleRow}>
        <span className={styles.toggleLabel}>{t('badges.enableGlobally')}</span>
        <Toggle checked={enabled} onChange={handleGlobalToggle} />
      </div>

      {enabled && allSites.length > 0 && (
        <>
          <SectionLabel style={{ marginTop: 8 }}>{t('badges.siteConfigurations')}</SectionLabel>
          <SectionHint>{t('badges.siteHint')}</SectionHint>

          {allSites.map((domain) => {
            const siteEnabled = !disabledSites.includes(domain);
            const hasCustom = !!customAdapters[domain];
            return (
              <button key={domain} className={styles.permRow} onClick={() => onOpenDetail(domain)}>
                <SiteIcon domain={domain} />
                <div className={styles.permInfo}>
                  <div className={styles.permDomain}>{domain}</div>
                  {hasCustom && <span className={styles.siteBadge}>{t('badges.custom')}</span>}
                </div>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <div onClick={(e) => e.stopPropagation()} role="presentation">
                  <Toggle checked={siteEnabled} onChange={() => handleSiteToggle(domain)} />
                </div>
                <IconChevronRight className={styles.chevron} size={14} />
              </button>
            );
          })}
        </>
      )}

      {enabled && allSites.length === 0 && (
        <EmptyState
          text={t('badges.noSitesWithAccess')}
          hint={t('badges.sitesWillAppear')}
        />
      )}
    </div>
  );
}
