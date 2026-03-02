import { useReducer, useCallback, useRef, useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import {
  createInitialState,
  reducer,
} from '../wizardMachine.ts';
import type { WizardState, WizardAction, WizardOptions, WizardContext } from '../wizardMachine.ts';

const STORAGE_KEY = 'wizardState';
const PERSIST_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface UseWizardFlowOptions {
  initialStep?: string;
  skipLang?: boolean;
  hasAccounts?: boolean;
  hasGeneratedAccount?: boolean;
  persist?: boolean;
}

interface UseWizardFlowResult {
  step: string;
  context: WizardContext;
  account: unknown | null;
  mnemonic: string | null;
  upgradeId: string | null;
  send: (type: string, payload?: Record<string, unknown>) => void;
  goBack: () => void;
  reset: () => void;
  showBack: boolean;
  loading: boolean;
}

/**
 * Shared wizard state + navigation for popup WizardOverlay and full-page OnboardingApp.
 * Thin wrapper around the pure wizardMachine reducer.
 *
 * When `persist: true`, state is saved to chrome.storage.session so the
 * wizard survives popup close/reopen (e.g. user clicks away to check seed file).
 */
export default function useWizardFlow({
  initialStep = 'lang',
  skipLang = false,
  hasAccounts = false,
  hasGeneratedAccount = false,
  persist = false,
}: UseWizardFlowOptions = {}): UseWizardFlowResult {
  const optionsRef = useRef<WizardOptions>({ initialStep, skipLang, hasAccounts, hasGeneratedAccount });
  optionsRef.current = { initialStep, skipLang, hasAccounts, hasGeneratedAccount };

  const wrappedReducer = useCallback(
    (state: WizardState, action: WizardAction): WizardState =>
      reducer(state, action, optionsRef.current),
    [],
  );

  const [state, dispatch] = useReducer(
    wrappedReducer,
    { initialStep, skipLang } as WizardOptions,
    createInitialState,
  );

  const [loading, setLoading] = useState(persist);
  const restoredRef = useRef(false);

  // Restore saved state on mount (persist mode only)
  useEffect(() => {
    if (!persist) return;
    browser.storage.session.get(STORAGE_KEY)
      .then((data: Record<string, unknown>) => {
        const saved = data[STORAGE_KEY] as { step?: string; ctx?: WizardContext; ts?: number } | undefined;
        if (saved?.step && saved?.ctx && saved?.ts && Date.now() - saved.ts < PERSIST_TTL_MS) {
          dispatch({ type: 'RESTORE', payload: saved as unknown as Record<string, unknown> });
          restoredRef.current = true;
        } else if (saved) {
          // Expired — clean up
          browser.storage.session.remove([STORAGE_KEY, 'wizardCreateData']).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist state changes (persist mode only, after initial restore).
  // Only save mid-flow steps — entry points and terminal steps clear storage.
  const NON_PERSIST_STEPS = ['lang', 'welcome', 'method', 'done'];
  useEffect(() => {
    if (!persist || loading) return;
    if (NON_PERSIST_STEPS.includes(state.step)) {
      browser.storage.session.remove([STORAGE_KEY, 'wizardCreateData']).catch(() => {});
    } else {
      browser.storage.session.set({ [STORAGE_KEY]: { step: state.step, ctx: state.ctx, ts: Date.now() } }).catch(() => {});
    }
  }, [persist, loading, state.step, state.ctx]);

  const send = useCallback(
    (type: string, payload?: Record<string, unknown>): void =>
      dispatch({ type, payload }),
    [],
  );

  const goBack = useCallback((): void => dispatch({ type: 'BACK' }), []);

  const reset = useCallback((): void => {
    if (persist) {
      browser.storage.session.remove([STORAGE_KEY, 'wizardCreateData']).catch(() => {});
    }
    dispatch({ type: 'RESET' });
  }, [persist]);

  const { step, ctx } = state;
  const showBack = step !== (skipLang ? 'method' : initialStep)
    && step !== 'done'
    && !(step === 'method' && !ctx.visitedPreMethod);

  return {
    step,
    context: ctx,
    account: ctx.account,
    mnemonic: ctx.mnemonic,
    upgradeId: ctx.upgradeId,
    send,
    goBack,
    reset,
    showBack,
    loading,
  };
}
