import { useCallback, useEffect, useState } from "react";

export type Async<T> = { data: T | null; error: string | null; loading: boolean; reload(): void };

/** Runs [load] when [deps] change; keeps the last good data while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e) => alive && setState((s) => ({ data: s.data, error: (e as Error).message, loading: false })),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
