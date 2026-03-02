import React, { ReactNode } from 'react';
import styles from './MenuOverlay.module.css';

interface MenuSectionProps {
  children: ReactNode;
}

export default function MenuSection({ children }: MenuSectionProps) {
  return <div className={styles.section}>{children}</div>;
}
