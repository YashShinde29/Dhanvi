"use client";
import { useCallback, useSyncExternalStore } from "react";

/** True when the media query matches. Server render and first client paint report `false`, so markup stays hydration-safe. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Phone layout (drawer sidebar + bottom nav): the same breakpoint the stylesheet uses for card-mode tables and sheets. */
export function useIsPhone(): boolean { return useMediaQuery("(max-width: 767px)"); }
