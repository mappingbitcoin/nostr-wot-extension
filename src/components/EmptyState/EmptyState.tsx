import React from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: React.ReactNode;
  text?: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ icon, text, hint, children, className = '' }: EmptyStateProps) {
  return (
    <div className={`${styles.emptyState} ${className}`}>
      {icon && <div className={styles.icon}>{icon}</div>}
      {text && <div className={styles.text}>{text}</div>}
      {hint && <div className={styles.hint}>{hint}</div>}
      {children}
    </div>
  );
}
