import { useReducer, useCallback, useRef } from 'react';
import {
  createInitialState,
  reducer,
} from '../wizardMachine.ts';
import type { WizardState, WizardAction, WizardOptions, WizardContext } from '../wizardMachine.ts';

interface UseWizardFlowOptions {
  initialStep?: string;
  skipLang?: boolean;
  hasAccounts?: boolean;
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
}

/**
 * Shared wizard state + navigation for popup WizardOverlay and full-page OnboardingApp.
 * Thin wrapper around the pure wizardMachine reducer.
 */
export default function useWizardFlow({
  initialStep = 'lang',
  skipLang = false,
  hasAccounts = false,
}: UseWizardFlowOptions = {}): UseWizardFlowResult {
  const optionsRef = useRef<WizardOptions>({ initialStep, skipLang, hasAccounts });
  optionsRef.current = { initialStep, skipLang, hasAccounts };

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

  const send = useCallback(
    (type: string, payload?: Record<string, unknown>): void =>
      dispatch({ type, payload }),
    [],
  );

  const goBack = useCallback((): void => dispatch({ type: 'BACK' }), []);
  const reset = useCallback((): void => dispatch({ type: 'RESET' }), []);

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
  };
}
