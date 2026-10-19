import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './client';

export interface Async<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches on mount and when `deps` change; `reload()` refetches without clearing current data. */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[], enabled = true): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (id !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (id === seq.current) setError(e);
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    const sequence = seq;
    setData(null);
    setError(null);
    if (enabled) run();
    else setLoading(false);
    return () => { sequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  return { data, error, loading, reload: run };
}
