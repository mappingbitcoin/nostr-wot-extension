import React, { useState, useMemo } from 'react';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

// Decoy words from BIP-39 for verification
const DECOYS = ['abandon', 'ability', 'achieve', 'acquire', 'adapt', 'adjust', 'admit', 'afford'];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

interface VerifyStepProps {
  mnemonic: string | null;
  onVerified: () => void;
}

export default function VerifyStep({ mnemonic, onVerified }: VerifyStepProps) {
  const words = useMemo(() => (mnemonic || '').split(' '), [mnemonic]);

  // Pick 4 random positions to blank
  const blankIndices = useMemo(() => {
    const indices = words.map((_, i) => i);
    return pickRandom(indices, 4).sort((a, b) => a - b);
  }, [words]);

  // Word bank: 4 correct + 4 decoys, shuffled
  const wordBank = useMemo(() => {
    const correct = blankIndices.map((i) => words[i]);
    const available = DECOYS.filter((d) => !correct.includes(d));
    const decoys = pickRandom(available, 4);
    return [...correct, ...decoys].sort(() => Math.random() - 0.5);
  }, [blankIndices, words]);

  const [filledSlots, setFilledSlots] = useState<Record<number, string>>({});
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [wrongSlots, setWrongSlots] = useState<Set<number>>(new Set());
  const [verified, setVerified] = useState<boolean>(false);

  const nextEmptySlot = blankIndices.find((i) => filledSlots[i] === undefined);

  const handleChipClick = (word: string) => {
    if (selectedChips.has(word) || verified) return;
    if (nextEmptySlot === undefined) return;

    const newFilled = { ...filledSlots, [nextEmptySlot]: word };
    const newSelected = new Set(selectedChips);
    newSelected.add(word);

    // Clear wrong state when user places a new word
    const newWrong = new Set(wrongSlots);
    newWrong.delete(nextEmptySlot);

    setFilledSlots(newFilled);
    setSelectedChips(newSelected);
    setWrongSlots(newWrong);

    // Check if all slots are filled
    if (Object.keys(newFilled).length === blankIndices.length) {
      const allCorrect = blankIndices.every((i) => newFilled[i] === words[i]);
      if (allCorrect) {
        setVerified(true);
      } else {
        // Highlight wrong slots so user can click to fix them
        const wrong = new Set<number>();
        blankIndices.forEach((i) => {
          if (newFilled[i] !== words[i]) wrong.add(i);
        });
        setWrongSlots(wrong);
      }
    }
  };

  const handleSlotClick = (slotIndex: number) => {
    if (verified) return;
    const word = filledSlots[slotIndex];
    if (word === undefined) return;

    const newFilled = { ...filledSlots };
    delete newFilled[slotIndex];
    const newSelected = new Set(selectedChips);
    newSelected.delete(word);
    const newWrong = new Set(wrongSlots);
    newWrong.delete(slotIndex);

    setFilledSlots(newFilled);
    setSelectedChips(newSelected);
    setWrongSlots(newWrong);
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.verifyTitle')}</h2>
      <p className={styles.stepDesc}>
        {t('wizard.verifyDesc')}
      </p>

      <div className={styles.mnemonicDisplay}>
        {words.map((word, i) => {
          const isBlank = blankIndices.includes(i);
          const filled = filledSlots[i];
          const isWrong = wrongSlots.has(i);
          const isClickable = isBlank && filled !== undefined && !verified;
          return (
            <div
              key={i}
              className={`${styles.mnemonicWord} ${isBlank ? styles.blank : ''} ${isWrong ? styles.wordWrong : ''} ${isClickable ? styles.wordClickable : ''}`}
              onClick={isClickable ? () => handleSlotClick(i) : undefined}
            >
              <span className={styles.wordNum}>{i + 1}</span>
              {isBlank ? (filled || '___') : word}
            </div>
          );
        })}
      </div>

      {!verified && (
        <div className={styles.wordBank}>
          {wordBank.map((word) => (
            <button
              key={word}
              className={`${styles.wordChip} ${selectedChips.has(word) ? styles.wordChipSelected : ''}`}
              onClick={() => handleChipClick(word)}
              disabled={selectedChips.has(word)}
            >
              {word}
            </button>
          ))}
        </div>
      )}

      {verified && (
        <div className={styles.stepActions}>
          <Button onClick={onVerified}>{t('common.continue')}</Button>
        </div>
      )}
    </div>
  );
}
