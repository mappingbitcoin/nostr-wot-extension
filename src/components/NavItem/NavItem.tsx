import React from 'react';
import { IconChevronRight } from '@assets';
import styles from './NavItem.module.css';

interface NavItemProps {
  icon?: React.ReactNode;
  label: string;
  desc?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

export default function NavItem({ icon, label, desc, onClick, className = '' }: NavItemProps) {
  return (
    <button className={`${styles.navItem} ${className}`} onClick={onClick}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.content}>
        <span className={styles.label}>{label}</span>
        {desc && <span className={styles.desc}>{desc}</span>}
      </div>
      <IconChevronRight className={styles.chevron} />
    </button>
  );
}
