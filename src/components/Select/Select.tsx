import React from 'react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  small?: boolean;
  className?: string;
}

export default function Select({ options, value, onChange, small = false, className = '', ...rest }: SelectProps) {
  const cls = [styles.select, small && styles.small, className].filter(Boolean).join(' ');
  return (
    <select className={cls} value={value} onChange={onChange} {...rest}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
