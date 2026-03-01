import React from 'react';
import styles from './ChipGroup.module.css';

interface ChipOption {
  value: string | number;
  label: string;
}

interface ChipGroupProps {
  options: ChipOption[];
  value: string | number;
  onChange: (value: any) => void;
  className?: string;
}

export default function ChipGroup({ options, value, onChange, className = '' }: ChipGroupProps) {
  return (
    <div className={`${styles.chipGroup} ${className}`}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          className={`${styles.chip} ${value === opt.value ? styles.chipActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
