import React from 'react';

const CYCLE = 9;
const HOLD_END = 7.8;
const FADE_END = 8.7;
const CENTER: [number, number] = [24, 24];
const MID_R = 3.5;
const END_R = 2.5;
const BRANCH_GAP = 0.95;

interface Branch {
  mid: [number, number];
  ends: [number, number][];
}

const BRANCHES: Branch[] = [
  { mid: [24, 12], ends: [[18, 6], [30, 6]] },
  { mid: [34, 17], ends: [[42, 12]] },
  { mid: [36, 27], ends: [[43, 30]] },
  { mid: [30, 35], ends: [[35, 42]] },
  { mid: [17, 34], ends: [[12, 42]] },
  { mid: [12, 22], ends: [[5, 18]] },
];

const dist = ([ax, ay]: [number, number], [bx, by]: [number, number]): number =>
  Math.ceil(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2));

const t = (s: number): number => +(Math.max(0, Math.min(CYCLE, s)) / CYCLE).toFixed(4);

interface AnimAttrs {
  attributeName: string;
  values: string;
  keyTimes: string;
}

function lineAnims(len: number, startSec: number): AnimAttrs[] {
  const s = Math.max(0.01, startSec);
  return [
    {
      attributeName: 'stroke-dashoffset',
      values: [len, len, 0, 0, len, len].join(';'),
      keyTimes: [0, t(s), t(s + 0.4), t(FADE_END), t(FADE_END + 0.01), 1].join(';'),
    },
    {
      attributeName: 'opacity',
      values: [0, 0, 1, 1, 0, 0].join(';'),
      keyTimes: [0, t(s), t(s + 0.02), t(HOLD_END), t(FADE_END), 1].join(';'),
    },
  ];
}

function dotAnims(targetR: number, startSec: number): AnimAttrs[] {
  const s = Math.max(0.01, startSec);
  return [
    {
      attributeName: 'r',
      values: [0, 0, targetR * 1.3, targetR, targetR, 0, 0].join(';'),
      keyTimes: [0, t(s), t(s + 0.12), t(s + 0.22), t(HOLD_END), t(FADE_END), 1].join(';'),
    },
    {
      attributeName: 'opacity',
      values: [0, 0, 1, 1, 0, 0].join(';'),
      keyTimes: [0, t(s), t(s + 0.12), t(HOLD_END), t(FADE_END), 1].join(';'),
    },
  ];
}

function Anim(props: Record<string, unknown>) {
  return <animate {...props} dur={`${CYCLE}s`} repeatCount="indefinite" />;
}

interface AnimatedWotLogoProps {
  size?: number;
}

export default function AnimatedWotLogo({ size = 96 }: AnimatedWotLogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Center dot — always visible */}
      <circle cx={24} cy={24} r={5} fill="rgb(99,102,241)" />

      {BRANCHES.map((branch, i) => {
        const bs = i * BRANCH_GAP;
        const innerLen = dist(CENTER, branch.mid);

        return (
          <g key={i}>
            {/* Inner line: center -> midpoint */}
            <line
              x1={24} y1={24} x2={branch.mid[0]} y2={branch.mid[1]}
              stroke="rgba(99,102,241,0.5)" strokeWidth="1.5"
              strokeDasharray={innerLen} strokeDashoffset={innerLen} opacity="0"
            >
              {lineAnims(innerLen, bs).map((a, k) => <Anim key={k} {...a} />)}
            </line>

            {/* Midpoint dot */}
            <circle
              cx={branch.mid[0]} cy={branch.mid[1]} r="0"
              fill="rgba(99,102,241,0.9)" opacity="0"
            >
              {dotAnims(MID_R, bs + 0.35).map((a, k) => <Anim key={k} {...a} />)}
            </circle>

            {/* Outer lines + endpoint dots */}
            {branch.ends.map((end, j) => {
              const outerLen = dist(branch.mid, end);
              return (
                <g key={j}>
                  <line
                    x1={branch.mid[0]} y1={branch.mid[1]} x2={end[0]} y2={end[1]}
                    stroke="rgba(99,102,241,0.5)" strokeWidth="1.5"
                    strokeDasharray={outerLen} strokeDashoffset={outerLen} opacity="0"
                  >
                    {lineAnims(outerLen, bs + 0.5).map((a, k) => <Anim key={k} {...a} />)}
                  </line>
                  <circle
                    cx={end[0]} cy={end[1]} r="0"
                    fill="rgba(99,102,241,0.6)" opacity="0"
                  >
                    {dotAnims(END_R, bs + 0.75).map((a, k) => <Anim key={k} {...a} />)}
                  </circle>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
