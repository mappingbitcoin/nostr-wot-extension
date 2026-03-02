import React from 'react';
import { rpcNotify } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import '@shared/theme.css';
import './OnboardingApp.module.css';
import TopoBg from '@components/TopoBg/TopoBg';
import PulseLogo from '@components/PulseLogo/PulseLogo';
import useWizardFlow from '@shared/hooks/useWizardFlow.ts';
import WizardSteps from '../popup/components/Wizard/WizardSteps';

export default function OnboardingApp() {
  const flow = useWizardFlow({ initialStep: 'welcome' });

  const handleDone = () => { rpcNotify('configUpdated'); window.close(); };

  if (flow.step === 'welcome') {
    return (
      <div className="onboarding-root">
        <div className="onboarding-welcome">
          <TopoBg />
          <div className="onboarding-welcome-content">
            <PulseLogo />
            <h1>{t('onboarding.title')}</h1>
            <p>{t('onboarding.subtitle')}</p>
            <button className="onboarding-start-btn" onClick={() => flow.send('NEXT')}>
              {t('wizard.getStarted')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-root">
      <div className="onboarding-step-container">
        <WizardSteps flow={flow} onDone={handleDone} onClose={null} onLangSelect={() => flow.send('NEXT')} bodyClassName="onboarding-body" />
      </div>
    </div>
  );
}
