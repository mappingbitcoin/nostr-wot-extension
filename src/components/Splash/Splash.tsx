import React from 'react';
import TopoBg from '../TopoBg/TopoBg';
import PulseLogo from '../PulseLogo/PulseLogo';
import styles from './Splash.module.css';

interface SplashProps {
  visible?: boolean;
  onTransitionEnd?: () => void;
}

export default function Splash({ visible = true, onTransitionEnd }: SplashProps) {
  return (
    <TopoBg className={`${styles.splash} ${visible ? '' : styles.fadeOut}`}>
      <PulseLogo src="/icons/icon-base.svg" size={96} />
    </TopoBg>
  );
}
