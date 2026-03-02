/**
 * Pure wizard state machine -- no React dependencies.
 *
 * State shape: { step: string, ctx: { method, account, mnemonic, upgradeId, visitedPreMethod } }
 *
 * Reducer handles action { type, payload? } plus runtime `options` injected by the hook.
 */

export interface WizardContext {
  method: string | null;
  account: unknown | null;
  mnemonic: string | null;
  upgradeId: string | null;
  visitedPreMethod: boolean;
}

export interface WizardState {
  step: string;
  ctx: WizardContext;
}

export interface WizardAction {
  type: string;
  payload?: Record<string, unknown>;
}

export interface WizardOptions {
  initialStep?: string;
  skipLang?: boolean;
  hasAccounts?: boolean;
  hasGeneratedAccount?: boolean;
}

interface TransitionResult {
  step: string;
  ctx?: Partial<WizardContext>;
}

type TransitionHandler = (
  ctx: WizardContext,
  payload: Record<string, unknown>,
  options: WizardOptions
) => TransitionResult | null;

const TRANSITIONS: Record<string, Record<string, TransitionHandler>> = {
  lang: {
    NEXT: (_ctx) => ({ step: 'method', ctx: { visitedPreMethod: true } }),
  },

  welcome: {
    NEXT: (_ctx) => ({ step: 'method', ctx: { visitedPreMethod: true } }),
  },

  method: {
    SELECT: (_ctx, { method }, { hasGeneratedAccount }) => {
      const step = (method === 'create' && hasGeneratedAccount) ? 'subaccount' : method as string;
      return { step, ctx: { method: method as string } };
    },
    BACK: (ctx, _payload, { initialStep }) =>
      ctx.visitedPreMethod ? { step: initialStep! } : null,
  },

  create: {
    CREATED: (_ctx, { account, mnemonic }) => ({
      step: 'verify',
      ctx: { account: account as unknown, mnemonic: mnemonic as string },
    }),
    BACK: () => ({ step: 'method' }),
  },

  subaccount: {
    CREATED: (_ctx, { account }) => ({
      step: 'followSuggestions',
      ctx: { account: account as unknown },
    }),
    BACK: () => ({ step: 'method' }),
  },

  import: {
    IMPORTED: (_ctx, { account, upgradeId }) => ({
      step: 'password',
      ctx: { account: account as unknown, upgradeId: upgradeId as string },
    }),
    BACK: () => ({ step: 'method' }),
  },

  npub: {
    DONE: (_ctx, { account }) => ({ step: 'wotSync', ctx: { account: account as unknown } }),
    BACK: () => ({ step: 'method' }),
  },

  nip46: {
    DONE: (_ctx, { account }) => ({ step: 'wotSync', ctx: { account: account as unknown } }),
    BACK: () => ({ step: 'method' }),
  },

  backup: {
    DONE: () => ({ step: 'verify' }),
    BACK: () => ({ step: 'create' }),
  },

  verify: {
    VERIFIED: () => ({ step: 'password' }),
    BACK: () => ({ step: 'create' }),
  },

  password: {
    SET: (ctx, { upgraded }) => {
      if (upgraded) return { step: 'done' };
      // Only show follow suggestions for new identity creation
      if (ctx.method === 'create') return { step: 'followSuggestions' };
      return { step: 'wotSync' };
    },
    BACK: (ctx) => {
      if (ctx.method === 'create') return { step: 'verify' };
      if (ctx.method === 'import') return { step: 'import' };
      return { step: 'method' };
    },
  },

  followSuggestions: {
    DONE: () => ({ step: 'wotSync' }),
    BACK: (ctx, _payload, { hasGeneratedAccount }) => {
      // Subaccounts skip password, go back to subaccount step
      if (ctx.method === 'create' && hasGeneratedAccount) return { step: 'subaccount' };
      return { step: 'password' };
    },
  },

  wotSync: {
    DONE: (_ctx, _payload, { hasAccounts }) => ({
      step: hasAccounts ? 'permCopy' : 'done',
    }),
    BACK: (ctx) => {
      if (ctx.method === 'create') return { step: 'followSuggestions' };
      return { step: 'password' };
    },
  },

  permCopy: {
    DONE: () => ({ step: 'done' }),
    BACK: () => ({ step: 'wotSync' }),
  },

  done: {
    // terminal -- no transitions
  },
};

export function createInitialState({ initialStep = 'lang', skipLang = false }: WizardOptions = {}): WizardState {
  const step = skipLang ? 'method' : initialStep;
  return {
    step,
    ctx: {
      method: null,
      account: null,
      mnemonic: null,
      upgradeId: null,
      visitedPreMethod: skipLang,
    },
  };
}

export function reducer(state: WizardState, action: WizardAction, options: WizardOptions = {}): WizardState {
  if (action.type === 'RESET') {
    return createInitialState(options);
  }

  if (action.type === 'RESTORE' && action.payload) {
    return {
      step: action.payload.step as string,
      ctx: action.payload.ctx as unknown as WizardContext,
    };
  }

  const stepTransitions = TRANSITIONS[state.step];
  if (!stepTransitions) return state;

  const handler = stepTransitions[action.type];
  if (!handler) return state;

  const result = handler(state.ctx, action.payload || {}, options);
  if (!result) return state; // guard blocked

  return {
    step: result.step,
    ctx: { ...state.ctx, ...result.ctx },
  };
}
