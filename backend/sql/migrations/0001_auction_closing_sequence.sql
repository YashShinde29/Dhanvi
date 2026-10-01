-- 0001 — Digital auction closing sequence (Going Once → Going Twice → Final Call → Finalizing).
--
-- First migration owned by the Fastify stack. Strictly additive: existing rows and history are untouched,
-- and code unaware of these columns keeps working.
--
-- The auction keeps "Status" = 'Open' for the whole closing sequence, so the existing
-- guard_auction_bid_insert trigger (bids only while Open) and the terminal-immutability trigger keep
-- protecting history unchanged. COMPLETED is derived from the terminal status and is never stored here.

ALTER TABLE groups."Auctions"
    ADD COLUMN "ClosingPhase" character varying(20),
    ADD COLUMN "ClosingPhaseEndsAt" timestamp with time zone,
    ADD COLUMN "ClosingStartedAt" timestamp with time zone,
    -- Monotonic token. Every closing transition and every closing reset increments it; delayed BullMQ
    -- jobs carry the value they were scheduled for and no-op when it no longer matches.
    ADD COLUMN "ClosingVersion" integer NOT NULL DEFAULT 0;

ALTER TABLE groups."Auctions" ADD CONSTRAINT "CK_Auction_Closing" CHECK (
    "ClosingVersion" >= 0
    AND (
        ("ClosingPhase" IS NULL AND "ClosingPhaseEndsAt" IS NULL AND "ClosingStartedAt" IS NULL)
        OR ("ClosingPhase" IN ('GOING_ONCE', 'GOING_TWICE', 'FINAL_WARNING')
            AND "ClosingPhaseEndsAt" IS NOT NULL AND "ClosingStartedAt" IS NOT NULL AND "LastBidSequence" > 0)
        OR ("ClosingPhase" = 'FINALIZING' AND "ClosingPhaseEndsAt" IS NULL AND "ClosingStartedAt" IS NOT NULL AND "LastBidSequence" > 0)
    )
    -- A closing sequence only exists on an open auction (or on the terminal row it produced).
    AND ("ClosingPhase" IS NULL OR "Status" IN ('Open', 'WinnerSelected'))
);

-- The scheduler sweep looks for open auctions whose window or closing phase has elapsed.
CREATE INDEX "IX_Auctions_Open_Deadlines" ON groups."Auctions" ("EndsAt", "ClosingPhaseEndsAt") WHERE "Status" = 'Open';
