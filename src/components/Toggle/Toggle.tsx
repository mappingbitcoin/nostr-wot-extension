import React from 'react';
import styles from './Toggle.module.css';

interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

export default function Toggle({ checked, onChange, ...rest }: ToggleProps) {
  return (
    <label className={styles.switch}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.checked)}
        {...rest}
      />
      <span className={styles.slider} />
    </label>
  );
}
