import React, { useState, useMemo, KeyboardEvent } from 'react';
import { getSupportedLanguages, setLanguage, getLanguage, t } from '@lib/i18n.js';
import TopoBg from '@components/TopoBg/TopoBg';
import AnimatedWotLogo from '@components/AnimatedWotLogo/AnimatedWotLogo';
import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

const ITEM_H = 36;
const PAUSE = 2.5;
const SLIDE = 0.4;
const STEP = PAUSE + SLIDE;

interface ScrollKeyframes {
  css: string;
  duration: number;
}

interface Language {
  code: string;
  native: string;
  flag: string;
  prompt: string;
}

function buildScrollKeyframes(n: number): ScrollKeyframes | null {
  if (n <= 1) return null;
  const total = n * STEP;
  const lines: string[] = ['@keyframes langPromptScroll {'];
  for (let i = 0; i < n; i++) {
    const holdStart = ((i * STEP) / total) * 100;
    const holdEnd = ((i * STEP + PAUSE) / total) * 100;
    const slideEnd = (((i + 1) * STEP) / total) * 100;
    lines.push(`  ${holdStart.toFixed(2)}% { transform: translateY(-${i * ITEM_H}px); }`);
    lines.push(`  ${holdEnd.toFixed(2)}% { transform: translateY(-${i * ITEM_H}px); }`);
    if (i < n - 1) {
      lines.push(`  ${slideEnd.toFixed(2)}% { transform: translateY(-${(i + 1) * ITEM_H}px); }`);
    }
  }
  lines.push(`  100.00% { transform: translateY(-${n * ITEM_H}px); }`);
  lines.push('}');
  return { css: lines.join('\n'), duration: total };
}

interface LangStepProps {
  onSelect: (code: string) => void;
}

export default function LangStep({ onSelect }: LangStepProps) {
  const languages: Language[] = getSupportedLanguages();
  const currentCode = getLanguage();
  const initialIdx = languages.findIndex((l) => l.code === currentCode);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<Language>(languages[initialIdx >= 0 ? initialIdx : 0]);

  const anim = useMemo(() => buildScrollKeyframes(languages.length), [languages.length]);

  const handleConfirm = async () => {
    await setLanguage(selected.code);
    onSelect(selected.code);
  };

  // Single language -- skip picker entirely
  if (languages.length === 1) {
    const lang = languages[0];
    return (
      <TopoBg className={styles.langScreen}>
        <div className={styles.langHero}>
          <AnimatedWotLogo size={112} />
          <span className={styles.langAppName}>Nostr WoT</span>
        </div>
        <div className={styles.langDivider} />
        <div className={styles.langPicker}>
          <div className={styles.langTrigger}>
            <span className={styles.langTriggerSelected}>{lang.flag} {lang.native}</span>
          </div>
          <Button onClick={() => { setLanguage(lang.code); onSelect(lang.code); }}>
            {lang.native}
          </Button>
        </div>
      </TopoBg>
    );
  }

  return (
    <TopoBg className={styles.langScreen}>
      {anim && <style>{anim.css}</style>}
      <div className={styles.langHero}>
        <AnimatedWotLogo size={112} />
        <span className={styles.langAppName}>Nostr WoT</span>
      </div>
      <div className={styles.langDivider} />
      <div className={styles.langPicker}>
        {/* Dropdown trigger -- cycles prompt translations or shows selection */}
        <div
          className={styles.langTrigger}
          onClick={() => setModalOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => e.key === 'Enter' && setModalOpen(true)}
        >
          {selected ? (
            <span className={styles.langTriggerSelected}>
              {selected.flag} {selected.native}
            </span>
          ) : (
            <div className={styles.langTriggerScroll}>
              <div
                className={styles.langTriggerTrack}
                style={{ animation: `langPromptScroll ${anim!.duration}s linear infinite` }}
              >
                {languages.map((lang) => (
                  <div key={lang.code} className={styles.langTriggerItem}>
                    {lang.prompt}
                  </div>
                ))}
                {/* Duplicate first for seamless loop */}
                <div className={styles.langTriggerItem}>
                  {languages[0].prompt}
                </div>
              </div>
            </div>
          )}
          <svg className={styles.langTriggerChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Full-screen language modal with scroll wheel picker */}
      {modalOpen && (
        <div className={styles.langModal}>
          <div className={styles.langModalHeader}>
            <span className={styles.langModalTitle}>
              {selected?.prompt || languages[0].prompt}
            </span>
            <button
              className={styles.langModalClose}
              onClick={() => setModalOpen(false)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className={styles.langModalWheel}>
            <ScrollWheelPicker
              items={languages}
              selectedIndex={selected ? languages.findIndex((l) => l.code === selected.code) : 0}
              onChange={(i: number) => setSelected(languages[i])}
              renderItem={(lang: Language, _i: number, isActive: boolean) => (
                <div className={`${styles.langWheelItem} ${isActive ? styles.langWheelItemActive : ''}`}>
                  <span className={styles.langWheelFlag}>{lang.flag}</span>
                  <span className={styles.langWheelName}>{lang.native}</span>
                </div>
              )}
            />
          </div>

          <div className={styles.langModalBottom}>
            <Button onClick={handleConfirm}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </TopoBg>
  );
}
