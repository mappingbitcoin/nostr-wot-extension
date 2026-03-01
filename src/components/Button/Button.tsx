import React from 'react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  small = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    styles.btn,
    styles[variant],
    small && styles.small,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
