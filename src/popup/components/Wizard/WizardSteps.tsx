import React from 'react';
import { t } from '@lib/i18n.js';
import { IconChevronLeft, IconClose } from '@assets';
import LangStep from './LangStep';
import MethodStep from './MethodStep';
import ImportStep from './ImportStep';
import NpubStep from './NpubStep';
import Nip46Step from './Nip46Step';
import CreateStep from './CreateStep';
import VerifyStep from './VerifyStep';
import PasswordStep from './PasswordStep';
import BackupStep from './BackupStep';
import WotSyncStep from './WotSyncStep';
import PermissionCopyStep from './PermissionCopyStep';
import DoneStep from './DoneStep';
import styles from './WizardSteps.module.css';

interface WizardFlow {
  step: string;
  account: unknown;
  mnemonic: string | null;
  upgradeId: string | null;
  send: (type: string, payload?: Record<string, unknown>) => void;
  goBack: () => void;
  showBack: boolean;
  reset: () => void;
}

interface StepConfig {
  noHeader?: boolean;
  title?: string;
  content: React.ReactNode;
}

function buildSteps(
  flow: WizardFlow,
  onLangSelect: ((code: string) => void) | null,
  onDone: () => void,
  { hasAccounts }: { hasAccounts?: boolean } = {},
): Record<string, StepConfig> {
  return {
    lang: {
      noHeader: true,
      content: onLangSelect ? <LangStep onSelect={onLangSelect} /> : null,
    },
    welcome: {
      noHeader: true,
      content: null, // welcome screen handled externally by OnboardingApp
    },
    method: {
      title: hasAccounts ? t('wizard.addAccount') : t('wizard.getStarted'),
      content: <MethodStep onSelect={(m: string) => flow.send('SELECT', { method: m })} />,
    },
    import: {
      title: t('wizard.importKey'),
      content: <ImportStep onNext={(acct: any, upId: string | null) => flow.send('IMPORTED', { account: acct, upgradeId: upId })} />,
    },
    npub: {
      title: t('wizard.watchOnly'),
      content: <NpubStep onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    nip46: {
      title: t('wizard.nostrConnect'),
      content: <Nip46Step onNext={(acct: any) => flow.send('DONE', { account: acct })} />,
    },
    create: {
      title: t('wizard.createIdentity'),
      content: <CreateStep onNext={(acct: any, seed: string) => flow.send('CREATED', { account: acct, mnemonic: seed })} />,
    },
    backup: {
      title: t('wizard.backUpKeys'),
      content: <BackupStep mnemonic={flow.mnemonic} onNext={() => flow.send('DONE')} />,
    },
    verify: {
      title: t('wizard.verifyBackup'),
      content: <VerifyStep mnemonic={flow.mnemonic} onVerified={() => flow.send('VERIFIED')} />,
    },
    password: {
      title: t('wizard.setPassword'),
      content: (
        <PasswordStep
          account={flow.account}
          upgradeId={flow.upgradeId}
          onNext={(upgraded: boolean) => flow.send('SET', { upgraded })}
        />
      ),
    },
    wotSync: {
      title: t('wizard.wotSync'),
      content: <WotSyncStep onNext={() => flow.send('DONE')} />,
    },
    permCopy: {
      title: t('wizard.copyPermissions'),
      content: <PermissionCopyStep account={flow.account as any} onNext={() => flow.send('DONE')} />,
    },
    done: {
      title: t('wizard.allSet'),
      content: <DoneStep account={flow.account as any} onDone={onDone} />,
    },
  };
}

interface WizardStepsProps {
  flow: WizardFlow;
  onClose: (() => void) | null;
  onDone: () => void;
  onLangSelect: (code: string) => void;
  bodyClassName?: string;
  hasAccounts?: boolean;
}

export default function WizardSteps({ flow, onClose, onDone, onLangSelect, bodyClassName, hasAccounts }: WizardStepsProps) {
  const STEPS = buildSteps(flow, onLangSelect, onDone, { hasAccounts });
  const active = STEPS[flow.step];
  if (!active?.content) return null;

  // When user has accounts, back on the method step should close the wizard
  const showBack = flow.showBack || (flow.step === 'method' && !!hasAccounts);
  const handleBack = (flow.step === 'method' && hasAccounts) ? onClose : flow.goBack;

  return (
    <>
      {!active.noHeader && (
        <div className={styles.header}>
          {showBack ? (
            <button className={styles.backBtn} onClick={handleBack!}>
              <IconChevronLeft />
            </button>
          ) : (
            <div className={styles.placeholder} />
          )}
          <span className={styles.title}>{active.title}</span>
          {onClose ? (
            <button className={styles.closeBtn} onClick={onClose}>
              <IconClose />
            </button>
          ) : (
            <div className={styles.placeholder} />
          )}
        </div>
      )}
      <div className={`${styles.body} ${bodyClassName || ''}`}>
        {active.content}
      </div>
    </>
  );
}
