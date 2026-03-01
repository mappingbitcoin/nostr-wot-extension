import React from 'react';
import styles from './StatusDot.module.css';

const ALIASES: Record<string, string> = { allow: 'approved', deny: 'rejected', syncing: 'checking', synced: 'reachable' };

interface StatusDotProps {
  status: string;
  className?: string;
}

export default function StatusDot({ status, className = '' }: StatusDotProps) {
  const normalized = ALIASES[status] || status;
  const cls = [styles.dot, styles[normalized] || '', className].filter(Boolean).join(' ');
  return <span className={cls} />;
}
