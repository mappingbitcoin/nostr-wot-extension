import React from 'react';
import styles from './SectionLabel.module.css';

interface SectionLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children?: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = '', ...rest }: SectionLabelProps) {
  return (
    <label className={`${styles.sectionLabel} ${className}`} {...rest}>
      {children}
    </label>
  );
}

interface SectionHintProps {
  children?: React.ReactNode;
  className?: string;
}

export function SectionHint({ children, className = '' }: SectionHintProps) {
  return (
    <div className={`${styles.sectionHint} ${className}`}>
      {children}
    </div>
  );
}
