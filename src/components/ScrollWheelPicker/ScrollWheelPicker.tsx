import React, { useRef, useState, useCallback, useEffect } from 'react';
import styles from './ScrollWheelPicker.module.css';

const RADIUS = 150;
const DECEL = 0.95;
const MIN_VEL = 0.3;
const SNAP_LERP = 0.14;

interface ScrollWheelPickerProps<T> {
  items: T[];
  selectedIndex?: number;
  onChange?: (index: number) => void;
  renderItem?: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  itemHeight?: number;
  visibleCount?: number;
}

interface ScrollState {
  offset: number;
  vel: number;
  y: number;
  t: number;
  drag: boolean;
  raf: number | null;
  wt: ReturnType<typeof setTimeout> | null;
  pending?: boolean;
  startY?: number;
  pid?: number;
  target?: EventTarget | null;
  holdTimer?: ReturnType<typeof setTimeout>;
}

export default function ScrollWheelPicker<T>({
  items,
  selectedIndex = 0,
  onChange,
  renderItem,
  itemHeight = 48,
  visibleCount = 5,
}: ScrollWheelPickerProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const st = useRef<ScrollState>({
    offset: -selectedIndex * itemHeight,
    vel: 0,
    y: 0,
    t: 0,
    drag: false,
    raf: null,
    wt: null,
  });
  const [, tick] = useState<number>(0);
  const rerender = useCallback(() => tick(n => n + 1), []);

  const degPerItem = Math.asin(Math.min(1, itemHeight / RADIUS)) * (180 / Math.PI);
  const height = visibleCount * itemHeight;

  const clamp = useCallback((o: number): number => {
    const min = -(items.length - 1) * itemHeight;
    return Math.max(min, Math.min(0, o));
  }, [items.length, itemHeight]);

  const getIdx = useCallback((): number => {
    const i = Math.round(-st.current.offset / itemHeight);
    return Math.max(0, Math.min(items.length - 1, i));
  }, [items.length, itemHeight]);

  const snapTo = useCallback((i: number): void => {
    const s = st.current;
    const target = -i * itemHeight;
    const step = () => {
      const d = target - s.offset;
      if (Math.abs(d) < 0.5) {
        s.offset = target;
        s.raf = null;
        rerender();
        onChange?.(i);
        return;
      }
      s.offset += d * SNAP_LERP;
      rerender();
      s.raf = requestAnimationFrame(step);
    };
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame(step);
  }, [itemHeight, onChange, rerender]);

  const coast = useCallback((): void => {
    const s = st.current;
    if (s.drag) return;
    if (Math.abs(s.vel) < MIN_VEL) { snapTo(getIdx()); return; }
    s.offset = clamp(s.offset + s.vel);
    s.vel *= DECEL;
    rerender();
    s.raf = requestAnimationFrame(coast);
  }, [clamp, getIdx, snapTo, rerender]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const s = st.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.pending = true;
    s.drag = false;
    s.startY = e.clientY;
    s.y = e.clientY;
    s.pid = e.pointerId;
    s.target = e.currentTarget;
    s.t = Date.now();
    s.vel = 0;
    // Hold 150ms before drag activates
    s.holdTimer = setTimeout(() => {
      if (s.pending) {
        s.drag = true;
        (s.target as Element)?.setPointerCapture(s.pid!);
      }
    }, 150);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const s = st.current;
    if (!s.drag) return;
    const now = Date.now();
    const dy = e.clientY - s.y;
    const dt = Math.max(1, now - s.t);
    s.vel = (dy / dt) * 16;
    s.offset = clamp(s.offset + dy);
    s.y = e.clientY;
    s.t = now;
    rerender();
  }, [clamp, rerender]);

  const onPointerUp = useCallback((): void => {
    const s = st.current;
    clearTimeout(s.holdTimer);
    const wasDragging = s.drag;
    s.pending = false;
    s.drag = false;
    if (wasDragging) coast();
  }, [coast]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const s = st.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.offset = clamp(s.offset - e.deltaY * 0.5);
    rerender();
    clearTimeout(s.wt!);
    s.wt = setTimeout(() => snapTo(getIdx()), 120);
  }, [clamp, getIdx, snapTo, rerender]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      snapTo(Math.max(0, getIdx() - 1));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      snapTo(Math.min(items.length - 1, getIdx() + 1));
    }
  }, [items.length, getIdx, snapTo]);

  useEffect(() => {
    st.current.offset = -selectedIndex * itemHeight;
    rerender();
  }, []);

  useEffect(() => () => {
    if (st.current.raf) cancelAnimationFrame(st.current.raf);
    clearTimeout(st.current.wt!);
  }, []);

  const offset = st.current.offset;
  const current = getIdx();

  return (
    <div
      ref={ref}
      className={styles.wheel}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="listbox"
    >
      <div
        className={styles.band}
        style={{ height: itemHeight, top: '50%', marginTop: -itemHeight / 2 }}
      />
      {items.map((item, i) => {
        const dist = i + offset / itemHeight;
        const angle = dist * degPerItem;
        if (Math.abs(angle) > 85) return null;
        const opacity = Math.max(0, Math.cos(angle * Math.PI / 180));
        return (
          <div
            key={i}
            className={styles.item}
            style={{
              height: itemHeight,
              marginTop: -itemHeight / 2,
              transformOrigin: `center center ${-RADIUS}px`,
              transform: `rotateX(${-angle}deg)`,
              opacity,
            }}
            onClick={() => snapTo(i)}
            role="option"
            aria-selected={i === current}
          >
            {renderItem ? renderItem(item, i, i === current) : String(item)}
          </div>
        );
      })}
    </div>
  );
}
