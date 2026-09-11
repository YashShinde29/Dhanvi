"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "@/lib/errors";

interface AsyncState<T> { data: T | undefined; error: string; loading: boolean; reload: () => Promise<void>; setData: (updater: T | ((previous: T | undefined) => T | undefined)) => void }

/**
 * Loads data with cancellation on unmount/dependency change and exposes a reload
 * for post-mutation refreshes. `deps` should list everything the loader reads.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[], enabled = true): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState("");
  const [loadingState, setLoading] = useState(true);
  const version = useRef(0);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; });

  const run = useCallback(async (token: number, silent: boolean, isActive: () => boolean) => {
    if (!silent) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (isActive() && token === version.current) { setDataState(result); setError(""); }
    } catch (failure) {
      if (isActive() && token === version.current) setError(friendlyError(failure));
    } finally {
      if (isActive() && token === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const token = ++version.current;
    void run(token, false, () => active);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  const reload = useCallback(() => run(++version.current, true, () => true), [run]);
  const setData = useCallback((updater: T | ((previous: T | undefined) => T | undefined)) => {
    setDataState((previous) => (typeof updater === "function" ? (updater as (p: T | undefined) => T | undefined)(previous) : updater));
  }, []);
  return { data, error, loading: enabled && loadingState, reload, setData };
}
