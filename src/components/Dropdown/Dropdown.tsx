import React, { useState, useRef, useEffect } from 'react';
import { IconChevronDown } from '@assets';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.ts';
import styles from './Dropdown.module.css';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  placeholder?: string;
  className?: string;
}

export default function Dropdown({
  options,
  value,
  onChange,
  small = false,
  placeholder = '',
  className = '',
}: DropdownProps) {
  const [open, setOpen] = useState<boolean>(false);
  const { shouldRender: menuVisible, animating: menuAnimating } = useAnimatedVisible(open, 150);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : placeholder;

  const handleSelect = (val: string): void => {
    onChange(val);
    setOpen(false);
  };

  const triggerCls = [
    styles.trigger,
    small && styles.triggerSmall,
    open && styles.triggerOpen,
  ].filter(Boolean).join(' ');

  return (
    <div className={`${styles.wrapper} ${className}`} ref={wrapperRef}>
      <button
        type="button"
        className={triggerCls}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`${styles.triggerLabel} ${!selected ? styles.triggerPlaceholder : ''}`}>
          {label}
        </span>
        <IconChevronDown
          size={small ? 12 : 14}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
      </button>

      {menuVisible && (
        <div className={`${styles.menu} ${menuAnimating ? styles.menuExiting : ''}`}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={[
                styles.option,
                opt.value === value && styles.optionActive,
                small && styles.optionSmall,
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
