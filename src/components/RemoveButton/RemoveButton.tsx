import React from 'react';
import { IconClose } from '@assets';
import styles from './RemoveButton.module.css';

interface RemoveButtonProps {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export default function RemoveButton({ onClick }: RemoveButtonProps) {
  return (
    <button className={styles.removeBtn} onClick={onClick}>
      <IconClose size={14} />
    </button>
  );
}
