import type { RawEnv } from "./env.js";

/**
 * Digital auction closing sequence. Durations are configuration, never constants: production starts at
 * 30 s each, tests shorten them. Phase deadlines are anchored to the previous deadline (or to the bid that
 * reset the sequence), so a late worker never lengthens or shortens a phase.
 */
export interface AuctionConfig {
  automationEnabled: boolean;
  goingOnceSeconds: number;
  goingTwiceSeconds: number;
  finalWarningSeconds: number;
  sweepIntervalSeconds: number;
}

export function auctionConfig(env: RawEnv): AuctionConfig {
  return {
    automationEnabled: env.AUCTION_AUTOMATION_ENABLED,
    goingOnceSeconds: env.AUCTION_GOING_ONCE_SECONDS,
    goingTwiceSeconds: env.AUCTION_GOING_TWICE_SECONDS,
    finalWarningSeconds: env.AUCTION_FINAL_WARNING_SECONDS,
    sweepIntervalSeconds: env.AUCTION_SWEEP_INTERVAL_SECONDS,
  };
}
