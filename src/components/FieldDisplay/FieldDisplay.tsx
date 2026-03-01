import React from 'react';
import styles from './FieldDisplay.module.css';

interface FieldDisplayProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}

export default function FieldDisplay({ label, value, mono = false, className = '' }: FieldDisplayProps) {
  const rootCls = [styles.field, className].filter(Boolean).join(' ');
  const valCls = [styles.value, mono && styles.mono].filter(Boolean).join(' ');
  return (
    <div className={rootCls}>
      <span className={styles.label}>{label}</span>
      <span className={valCls}>{value}</span>
    </div>
  );
}
