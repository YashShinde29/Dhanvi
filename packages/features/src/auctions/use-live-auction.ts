"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { auctionService } from "@dhanvi/api-client";
import type { Auction } from "@dhanvi/types";
import { friendlyError } from "@dhanvi/utils";
import { clockOffset, screenPhase } from "./auction-model";

/**
 * Live auction state by efficient polling (the backend offers no push channel):
 * 3 s while OPEN, 20 s while SCHEDULED/CLOSING, stopped once completed, paused while the tab is hidden, never
 * overlapping, and refreshable immediately after the member's own bid. Only the auction endpoint is polled.
 */
export function useLiveAuction(groupId: string, cycleId: string) {
  const [auction, setAuction] = useState<Auction>();
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const inFlight = useRef(false);
  const phase = auction ? screenPhase(auction) : undefined;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { const next = await auctionService.get(groupId, cycleId); setAuction(next); setReceivedAt(Date.now()); setError(""); }
    catch (failure) { setError(friendlyError(failure)); }
    finally { inFlight.current = false; }
  }, [groupId, cycleId]);

  useEffect(() => {
    // First load, then polling by phase. Everything is timer-driven so the effect body itself never sets state.
    const initial = window.setTimeout(() => void refresh(), 0);
    if (phase === "COMPLETED" || phase === "NO_BIDS") return () => window.clearTimeout(initial);
    const interval = phase === "LIVE" ? 3000 : 20000;
    let timer: number | undefined;
    const schedule = () => { window.clearInterval(timer); if (document.visibilityState === "visible") timer = window.setInterval(() => void refresh(), interval); };
    const onVisibility = () => { if (document.visibilityState === "visible") window.setTimeout(() => void refresh(), 0); schedule(); };
    schedule(); document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [phase, refresh]);

  const offset = auction ? clockOffset(auction.serverTime, receivedAt) : 0;
  return { auction, error, refresh, setAuction, /** Server "now" estimate for countdowns. */ serverNow: () => Date.now() + offset };
}

/** Ticks once a second while `active`, for countdowns; stops otherwise. */
export function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => { if (!active) return; const t = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(t); }, [active]);
}
