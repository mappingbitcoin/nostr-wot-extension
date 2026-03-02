export function toPercent(value: number | null | undefined, defaultValue: number): number {
  return Math.round((value ?? defaultValue) * 100);
}

export function toFraction(value: string | number, defaultValue: number): number {
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed / 100;
}
