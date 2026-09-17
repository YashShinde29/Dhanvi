"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Tab selection lives in the URL (`?tab=`) so links, refreshes and back navigation keep the section. */
export function useTabParam(fallback: string, valid: readonly string[]): [string, (id: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = params.get("tab");
  const tab = requested && valid.includes(requested) ? requested : fallback;
  const setTab = useCallback((id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === fallback) next.delete("tab"); else next.set("tab", id);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [router, pathname, params, fallback]);
  return [tab, setTab];
}
