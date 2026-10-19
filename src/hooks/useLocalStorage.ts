import { useCallback, useState } from 'react';

function read<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** useState backed by localStorage. Falls back silently when storage is unavailable. */
export function useLocalStorage<T>(key: string, fallback: T, validate: (v: unknown) => v is T) {
  const [value, setValue] = useState<T>(() => read(key, fallback, validate));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private mode or blocked storage: keep the in-memory value only.
      }
    },
    [key],
  );
  return [value, set] as const;
}
