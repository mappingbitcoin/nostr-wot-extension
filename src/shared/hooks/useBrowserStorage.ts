import { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.ts';

type StorageArea = 'sync' | 'local' | 'session';

/**
 * Hook for browser.storage get/set with live change listener.
 * @param key - Storage key
 * @param defaultValue - Default value if key not found
 * @param area - Storage area
 * @returns Current value and setter
 */
export default function useBrowserStorage<T>(
  key: string,
  defaultValue: T | null = null,
  area: StorageArea = 'sync'
): [T | null, (val: T) => void] {
  const [value, setValue] = useState<T | null>(defaultValue);
  const defaultRef = useRef(defaultValue);

  useEffect(() => {
    // Initial read
    browser.storage[area].get(key).then((data: Record<string, unknown>) => {
      if (data[key] !== undefined) setValue(data[key] as T);
    });

    // Listen for changes
    function onChange(
      changes: Record<string, chrome.storage.StorageChange>,
      changedArea: string
    ): void {
      if (changedArea === area && changes[key]) {
        setValue((changes[key].newValue as T) ?? defaultRef.current);
      }
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [key, area]);

  const set = useCallback(
    (newValue: T): void => {
      setValue(newValue);
      browser.storage[area].set({ [key]: newValue });
    },
    [key, area]
  );

  return [value, set];
}
