import React from 'react';
import styles from './ModeCard.module.css';

interface ModeCardProps {
  active?: boolean;
  label: string;
  desc?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

export default function ModeCard({ active = false, label, desc, onClick, className = '' }: ModeCardProps) {
  const cls = [styles.card, active && styles.active, className].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={onClick}>
      <div className={`${styles.radio} ${active ? styles.radioActive : ''}`} />
      <div className={styles.content}>
        <div className={styles.label}>{label}</div>
        {desc && <div className={styles.desc}>{desc}</div>}
      </div>
    </button>
  );
}
