import React from 'react';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import styles from './InputRow.module.css';

interface InputRowProps {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  onSubmit?: () => void;
  buttonLabel: string;
  disabled?: boolean;
  error?: string;
  mono?: boolean;
  className?: string;
}

export default function InputRow({
  value,
  onChange,
  placeholder,
  onSubmit,
  buttonLabel,
  disabled = false,
  error,
  mono = false,
  className = '',
}: InputRowProps) {
  return (
    <div className={className}>
      <div className={styles.row}>
        <Input
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && onSubmit?.()}
          mono={mono}
        />
        <Button small onClick={onSubmit} disabled={disabled}>{buttonLabel}</Button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
