import React, { useState, useEffect } from 'react';
import { isLanguageChosen } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.ts';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import TopoBg from '@components/TopoBg/TopoBg';
import useWizardFlow from '@shared/hooks/useWizardFlow';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.ts';
import WizardSteps from './WizardSteps';
import styles from './WizardOverlay.module.css';

interface WizardOverlayProps {
  visible: boolean;
  canClose: boolean;
  onClose?: () => void;
  onComplete?: (account: unknown) => void;
}

export default function WizardOverlay({ visible, canClose, onClose, onComplete }: WizardOverlayProps) {
  const [hasGeneratedAccount, setHasGeneratedAccount] = useState(false);

  useEffect(() => {
    if (visible && canClose) {
      rpc<{ hasSeed: boolean }>('onboarding_checkExistingSeed')
        .then(r => setHasGeneratedAccount(!!r?.hasSeed))
        .catch(() => setHasGeneratedAccount(false));
    }
  }, [visible, canClose]);

  const flow = useWizardFlow({
    initialStep: 'lang',
    skipLang: isLanguageChosen(),
    hasAccounts: canClose,
    hasGeneratedAccount,
  });

  const { shouldRender, animating } = useAnimatedVisible(visible);

  const handleClose = () => { flow.reset(); onClose?.(); };
  const handleDone = () => { const acct = flow.account; flow.reset(); onComplete?.(acct); };

  if (!shouldRender) return null;

  return (
    <OverlayPanel showHeader={false} noPadding zIndex={500} animating={animating} className={styles.transparentOverlay}>
      <TopoBg className={styles.topoBgFill}>
        <WizardSteps
          flow={flow}
          onClose={canClose ? handleClose : null}
          onDone={handleDone}
          onLangSelect={() => flow.send('NEXT')}
          hasAccounts={canClose}
          hasGeneratedAccount={hasGeneratedAccount}
        />
      </TopoBg>
    </OverlayPanel>
  );
}
