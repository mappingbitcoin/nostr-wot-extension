import React from 'react';
import styles from './TopoBg.module.css';

interface TopoBgProps {
  className?: string;
  children?: React.ReactNode;
}

export default function TopoBg({ className = '', children }: TopoBgProps) {
  return (
    <div className={`${styles.topoBg} ${className}`}>
      {children}
    </div>
  );
}
