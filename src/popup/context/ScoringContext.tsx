import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { DEFAULT_SCORING } from '@lib/scoring.ts';
import { SENSITIVITY_PRESETS } from '@shared/constants.ts';

interface ScoringConfig {
  distanceWeights?: Record<number, number>;
  pathBonus?: Record<number, number> | number;
  maxPathBonus?: number;
}

interface PresetMatch {
  index: number;
  desc: string;
}

interface ScoringContextValue {
  scoring: ScoringConfig;
  presetIndex: number;
  presetDesc: string;
  setPreset: (idx: number) => Promise<void>;
  saveCustom: (s: ScoringConfig) => Promise<void>;
  reset: () => Promise<void>;
}

const ScoringContext = createContext<ScoringContextValue | null>(null);

/**
 * Match a scoring config to the nearest SENSITIVITY_PRESET index.
 * Returns { index, desc } or { index: 2, desc: "Custom: ..." } if no match.
 */
function matchPreset(scoring: ScoringConfig): PresetMatch {
  const w2 = scoring.distanceWeights?.[2] ?? 0.5;
  const w3 = scoring.distanceWeights?.[3] ?? 0.25;
  const pb2 = typeof scoring.pathBonus === 'object'
    ? ((scoring.pathBonus as Record<number, number>)?.[2] ?? 0.15)
    : ((scoring.pathBonus as number) ?? 0.1);

  for (let i = 0; i < SENSITIVITY_PRESETS.length; i++) {
    const p = SENSITIVITY_PRESETS[i];
    if (
      Math.abs(p.weights[2] - w2) < 0.001 &&
      Math.abs(p.weights[3] - w3) < 0.001 &&
      Math.abs(p.pathBonus[2] - pb2) < 0.001
    ) {
      return { index: i, desc: t(p.labelKey) + ': ' + t(p.descKey) };
    }
  }
  return { index: 2, desc: t('scoring.custom') };
}

/**
 * Build a full scoring object from a preset index.
 */
function presetToScoring(idx: number): ScoringConfig {
  const preset = SENSITIVITY_PRESETS[idx];
  return {
    distanceWeights: { 1: 1.0, ...preset.weights },
    pathBonus: preset.pathBonus,
    maxPathBonus: preset.maxPathBonus,
  };
}

interface ScoringProviderProps {
  children: ReactNode;
}

export function ScoringProvider({ children }: ScoringProviderProps) {
  const [scoring, setScoring] = useState<ScoringConfig>(DEFAULT_SCORING);
  const [presetIndex, setPresetIndex] = useState<number>(2);
  const [presetDesc, setPresetDesc] = useState<string>('');

  const applyMatch = useCallback((s: ScoringConfig) => {
    const { index, desc } = matchPreset(s);
    setPresetIndex(index);
    setPresetDesc(desc);
  }, []);

  // Load on mount
  useEffect(() => {
    browser.storage.sync.get(['scoring']).then((data: Record<string, unknown>) => {
      const s = (data.scoring as ScoringConfig | undefined) || DEFAULT_SCORING;
      setScoring(s);
      applyMatch(s);
    });
  }, [applyMatch]);

  // Listen for external changes (e.g. from another popup instance or background)
  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) {
      if (area === 'sync' && changes.scoring) {
        const s = (changes.scoring.newValue as ScoringConfig | undefined) || DEFAULT_SCORING;
        setScoring(s);
        applyMatch(s);
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [applyMatch]);

  /**
   * Apply a preset by index (0-4). Persists and notifies.
   */
  const setPreset = useCallback(async (idx: number) => {
    const s = presetToScoring(idx);
    setScoring(s);
    const preset = SENSITIVITY_PRESETS[idx];
    setPresetIndex(idx);
    setPresetDesc(t(preset.labelKey) + ': ' + t(preset.descKey));
    await browser.storage.sync.set({ scoring: s });
    rpcNotify('configUpdated');
  }, []);

  /**
   * Save a custom scoring config. Persists and notifies.
   */
  const saveCustom = useCallback(async (s: ScoringConfig) => {
    setScoring(s);
    applyMatch(s);
    await browser.storage.sync.set({ scoring: s });
    rpcNotify('configUpdated');
  }, [applyMatch]);

  /**
   * Reset to DEFAULT_SCORING (the "balanced" preset). Persists and notifies.
   */
  const reset = useCallback(async () => {
    setScoring(DEFAULT_SCORING);
    setPresetIndex(2);
    setPresetDesc(t(SENSITIVITY_PRESETS[2].labelKey) + ': ' + t(SENSITIVITY_PRESETS[2].descKey));
    await browser.storage.sync.set({ scoring: DEFAULT_SCORING });
    rpcNotify('configUpdated');
  }, []);

  const value: ScoringContextValue = {
    scoring,
    presetIndex,
    presetDesc,
    setPreset,
    saveCustom,
    reset,
  };

  return <ScoringContext.Provider value={value}>{children}</ScoringContext.Provider>;
}

export function useScoring(): ScoringContextValue {
  const ctx = useContext(ScoringContext);
  if (!ctx) throw new Error('useScoring must be used within ScoringProvider');
  return ctx;
}
