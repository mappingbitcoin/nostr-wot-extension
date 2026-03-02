import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

interface QrRect {
  x: number;
  y: number;
  size: number;
  key: string;
}

export default function QrCode({ value, size = 200, className }: QrCodeProps) {
  const cells = useMemo<QrRect[] | null>(() => {
    if (!value) return null;
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = size / moduleCount;
    const rects: QrRect[] = [];
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          rects.push({ x: col * cellSize, y: row * cellSize, size: cellSize, key: `${row}-${col}` });
        }
      }
    }
    return rects;
  }, [value, size]);

  if (!cells) return null;

  return (
    <div className={className}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <rect width={size} height={size} fill="#fff" />
        <g fill="currentColor">
          {cells.map((c) => (
            <rect key={c.key} x={c.x} y={c.y} width={c.size} height={c.size} />
          ))}
        </g>
      </svg>
    </div>
  );
}
