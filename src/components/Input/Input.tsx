import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import styles from './Input.module.css';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'password' | 'number';
  mono?: boolean;
  small?: boolean;
  center?: boolean;
  showToggle?: boolean;
  label?: string;
  error?: string;
  className?: string;
}

export default function Input({
  type = 'text',
  mono = false,
  small = false,
  center = false,
  showToggle = false,
  label,
  error,
  className = '',
  ...rest
}: InputProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const effectiveType = type === 'password' && visible ? 'text' : type;

  const cls = [styles.input, mono && styles.mono, small && styles.small, center && styles.center, className].filter(Boolean).join(' ');

  const input = (
    <div className={styles.wrap}>
      <input type={effectiveType} className={cls} {...rest} />
      {type === 'password' && showToggle && (
        <button
          type="button"
          tabIndex={-1}
          className={styles.toggle}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? t('common.hide') : t('common.show')}
        </button>
      )}
    </div>
  );

  if (!label && !error) return input;

  return (
    <div className={styles.formGroup}>
      {label && <label className={styles.label}>{label}</label>}
      {input}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
