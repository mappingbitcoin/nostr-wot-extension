import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { npubDecode, npubEncode } from '@lib/crypto/bech32.ts';
import { liveQuery } from '@lib/relay.ts';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import browser from '@lib/browser.ts';
import type { LiveEvent } from '@lib/types.ts';
import Button from '@components/Button/Button';
import styles from './WizardOverlay.module.css';

/* ------------------------------------------------------------------ */
/*  Curated account list — npubs only                                  */
/* ------------------------------------------------------------------ */

const TIER_1: string[] = [
  'npub1gxdhmu9swqduwhr6zptjy4ya693zp3ql28nemy4hd97kuufyrqdqwe5zfk',
  'npub1m9vsm9d8sy0pevcjhenwm4ny6l37dm2hsg4dnusna43ql3n5305qy4zlg4',
  'npub12pluyzs2n3kxvx6t8fsqaa8j23f4n7syy45fny0cah46uaxqm5pqgfgy5m',
];

const TIER_2: string[] = [
  'npub1a2cww4kn9wqte4ry70vyfwqyqvpswksna27rtxd8vty6c74era8sdcw83a', // lyn alden
  'npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z', // vitor pamplona
  'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6', // fiatjaf
  'npub1spdnfacgsd7lk0nlqkq443tkq4jx9z6c6ksvaquuewmw7d3qltpslcq6j7', // paul keating
  'npub1cn4t4cd78nm900qc2hhqte5aa8c9njm6qkfzw95tszufwcwtcnsq7g3vle', // jack mallers
  'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m', // jack dorsey
  'npub16c0nh3dnadzqpm76uctf5hqhe2lny344zsmpm6feee9p5rdxaa9q586nvr', // miljan
  'npub12rv5lskctqxxs2c8rf2zlzc7xx3qpvzs3w4etgemauy9thegr43sf485vg', // calle
  'npub1qnyd0r9f7g6u5z4x3c2v1b0n8m7k6j5h4g3f2d1s0a9p95gx', // odell
  'npub1s05n9m8k7j6h5g4f3d2s1a0p9o8i7u6y5t4r3e2w1q0eyhe', // jeff booth
  'npub15dqlghlewk84wz3pkqqvzl2w2w36f97g89ljds8x6c094nlu02vqjllm5m', // michael saylor
  'npub1g53mukxnjkcmr94fhryzkqutdz2ukq4ks0gvy5af25rgmwsl4ngq43drvk' // sirius
];

/* ------------------------------------------------------------------ */
/*  Selection algorithm                                                */
/* ------------------------------------------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function selectAccounts(): string[] {
  const shuffledT1 = shuffle(TIER_1);
  const shuffledT2 = shuffle(TIER_2);
  const used = new Set<string>();

  // First half: 1 TIER_1 + 4 TIER_2, shuffled
  const t1a = shuffledT1[0];
  used.add(t1a);
  const t2a = shuffledT2.filter((n) => !used.has(n)).slice(0, 4);
  t2a.forEach((n) => used.add(n));
  const firstHalf = shuffle([t1a, ...t2a]);

  // Second half: 1 more TIER_1 + 6 TIER_2, shuffled (no repeats)
  const t1b = shuffledT1.find((n) => !used.has(n))!;
  used.add(t1b);
  const t2b = shuffledT2.filter((n) => !used.has(n)).slice(0, 6);
  const secondHalf = shuffle([t1b, ...t2b]);

  return [...firstHalf, ...secondHalf];
}

/* ------------------------------------------------------------------ */
/*  Profile metadata types                                             */
/* ------------------------------------------------------------------ */

interface ProfileMeta {
  display_name?: string;
  name?: string;
  picture?: string;
  nip05?: string;
  _ts?: number;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface FollowSuggestionsStepProps {
  onNext: () => void;
}

export default function FollowSuggestionsStep({ onNext }: FollowSuggestionsStepProps) {
  const [checking, setChecking] = useState(true);
  const skippedRef = useRef(false);

  // Check if user already has follows — if so, skip this step
  useEffect(() => {
    let unmounted = false;
    (async () => {
      try {
        const data = await browser.storage.sync.get(['myPubkey']) as Record<string, string>;
        const myPubkey = data.myPubkey;
        if (!myPubkey) { setChecking(false); return; }

        const relays = DEFAULT_RELAYS.split(',');
        const gen = liveQuery(
          [{ kinds: [3], authors: [myPubkey], limit: 1 }],
          relays,
          { closeOnExhaust: true, cache: true },
        );
        for await (const msg of gen) {
          if (unmounted) break;
          if ((msg.type === 'event' || msg.type === 'update') &&
              msg.event.kind === 3 && msg.event.tags.length > 0) {
            skippedRef.current = true;
            gen.return(undefined);
            if (!unmounted) onNext();
            return;
          }
        }
      } catch { /* proceed to show suggestions */ }
      if (!unmounted) setChecking(false);
    })();
    return () => { unmounted = true; };
  }, [onNext]);

  const npubs = useMemo(() => selectAccounts(), []);
  const hexKeys = useMemo(
    () => npubs.reduce<Array<{ npub: string; hex: string }>>((acc, npub) => {
      try {
        acc.push({ npub, hex: npubDecode(npub) });
      } catch { /* skip invalid npub */ }
      return acc;
    }, []),
    [npubs],
  );

  const hexList = useMemo(() => hexKeys.map((a) => a.hex), [hexKeys]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(hexList));
  const [profiles, setProfiles] = useState<Record<string, ProfileMeta>>({});
  const [publishing, setPublishing] = useState(false);

  // Stream profiles via liveQuery
  useEffect(() => {
    let gen: AsyncGenerator<LiveEvent> | null = null;
    let unmounted = false;

    (async () => {
      const relays = DEFAULT_RELAYS.split(',');
      gen = liveQuery(
        [{ kinds: [0], authors: hexList }],
        relays,
        { closeOnExhaust: true, cache: true },
      );
      for await (const msg of gen) {
        if (unmounted) break;
        if (msg.type === 'event' || msg.type === 'update') {
          if (msg.event.kind === 0) {
            try {
              const meta = JSON.parse(msg.event.content);
              setProfiles(prev => {
                if (prev[msg.event.pubkey]?._ts !== undefined &&
                    prev[msg.event.pubkey]!._ts! >= msg.event.created_at) return prev;
                return { ...prev, [msg.event.pubkey]: { ...meta, _ts: msg.event.created_at } };
              });
            } catch { /* malformed content */ }
          }
        }
      }
    })();

    return () => { unmounted = true; gen?.return(undefined); };
  }, [hexList]);

  const toggle = (hex: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hex)) next.delete(hex);
      else next.add(hex);
      return next;
    });
  };

  const handleFollow = async () => {
    if (selected.size === 0) return;
    setPublishing(true);
    try {
      const tags = Array.from(selected).map((pk) => ['p', pk]);
      const event = {
        kind: 3,
        content: '',
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };
      await rpc('signAndPublishEvent', { event });
      onNext();
    } catch {
      setPublishing(false);
    }
  };

  const truncateNpub = (npub: string) => npub.slice(0, 12) + '...' + npub.slice(-6);

  const getName = (hex: string, npub: string) => {
    const p = profiles[hex];
    return p?.display_name || p?.name || truncateNpub(npub);
  };

  const getSubtitle = (hex: string, npub: string) => {
    const p = profiles[hex];
    return p?.nip05 || truncateNpub(npub);
  };

  const getAvatar = (hex: string) => profiles[hex]?.picture || null;

  const getInitial = (hex: string, npub: string) => {
    const name = getName(hex, npub);
    return name.charAt(0).toUpperCase();
  };

  return (
    <div className={styles.step}>
      <h2 className={styles.stepTitle}>{t('wizard.followTitle')}</h2>
      <p className={styles.stepDesc}>{t('wizard.followDesc')}</p>

      <div className={styles.suggestionList}>
        {hexKeys.map(({ npub, hex }) => {
          const isSelected = selected.has(hex);
          const avatar = getAvatar(hex);
          return (
            <div
              key={hex}
              className={`${styles.suggestionCard} ${isSelected ? styles.suggestionCardSelected : ''}`}
              onClick={() => toggle(hex)}
            >
              {avatar ? (
                <img
                  className={styles.suggestionAvatar}
                  src={avatar}
                  alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.suggestionHidden); }}
                />
              ) : null}
              {!avatar ? (
                <div className={styles.suggestionAvatarFallback}>
                  {getInitial(hex, npub)}
                </div>
              ) : (
                <div className={`${styles.suggestionAvatarFallback} ${styles.suggestionHidden}`}>
                  {getInitial(hex, npub)}
                </div>
              )}
              <div className={styles.suggestionInfo}>
                <span className={styles.suggestionName}>{getName(hex, npub)}</span>
                <span className={styles.suggestionNip05}>{getSubtitle(hex, npub)}</span>
              </div>
              <div className={`${styles.suggestionCheck} ${isSelected ? styles.suggestionCheckActive : ''}`}>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.suggestionCount}>
        {t('wizard.followSelected', { count: selected.size })}
      </div>

      <div className={styles.stepActions}>
        <Button variant="secondary" onClick={onNext} disabled={checking}>{t('wizard.skipForNow')}</Button>
        <Button
          onClick={handleFollow}
          disabled={selected.size === 0 || publishing || checking}
        >
          {checking ? t('common.loading') : publishing ? t('wizard.followPublishing') : t('wizard.followSuggestions')}
        </Button>
      </div>
    </div>
  );
}
