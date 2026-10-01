-- =====================================================================================================
-- Dhanvi PostgreSQL baseline — the production schema as it existed when the Fastify backend took over.
--
-- Source: `pg_dump --schema-only` of a database built by the historical (pre-Fastify, EF Core) migrations
-- (Identity, Organizers, Audit, Groups x8, Ledger x2, Payments, Payouts), followed by the reference rows they
-- create (roles, chart of accounts) and their migration-history rows, so a fresh database is structurally
-- identical to the existing production database.
--
-- How it is used (see src/scripts/migrate.ts and docs/fastify-migration/database-baseline.md):
--   * Existing Dhanvi database (identity.users already exists): this file is NEVER executed. The runner
--     records it as adopted and only applies sql/migrations/* on top.
--   * Empty database (local dev / tests): this file is executed once, then sql/migrations/*.
-- Do not edit historical objects here. Every future schema change is a new file in sql/migrations/.
-- psql meta-commands (\restrict) and PG17-only settings were stripped so it runs on PostgreSQL 16+.
-- =====================================================================================================
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: groups; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA groups;


--
-- Name: identity; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA identity;


--
-- Name: ledger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ledger;


--
-- Name: organizers; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA organizers;


--
-- Name: payments; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA payments;


--
-- Name: payouts; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA payouts;


--
-- Name: check_auction_allocation_total(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.check_auction_allocation_total() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE result_id uuid; result_row groups."AuctionResults"%ROWTYPE; allocation_count bigint; total numeric;
BEGIN
    IF TG_TABLE_NAME = 'AuctionResults' THEN result_id := NEW."Id";
    ELSE result_id := NEW."AuctionResultId"; END IF;
    SELECT * INTO STRICT result_row FROM groups."AuctionResults" WHERE "Id" = result_id;
    SELECT count(*), COALESCE(sum("Amount"), 0) INTO allocation_count, total
        FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id;
    IF allocation_count <> result_row."MemberLimit" OR total <> result_row."WinningDiscount"
        OR (SELECT count(*) FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id AND "AllocationType" = 'PlatformFee') <> 1
        OR (SELECT count(*) FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id AND "AllocationType" = 'MemberBenefit') <> result_row."MemberLimit" - 1
        OR EXISTS (SELECT 1 FROM groups."AuctionBenefitAllocations" a WHERE a."AuctionResultId" = result_id
            AND a."MembershipId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups."Contributions" c
                WHERE c."CycleId" = result_row."CycleId" AND c."MembershipId" = a."MembershipId"))
        OR EXISTS (SELECT 1 FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id
            AND ("Amount" <> result_row."GrossMemberShare" OR "MembershipId" = result_row."WinnerMembershipId"))
    THEN RAISE EXCEPTION 'Auction allocations must exactly conserve the discount'; END IF;
    RETURN NEW;
END;
$$;


--
-- Name: guard_auction_bid_insert(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.guard_auction_bid_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE auction_status text;
BEGIN
    SELECT "Status" INTO auction_status FROM groups."Auctions" WHERE "Id" = NEW."AuctionId" FOR UPDATE;
    IF auction_status IS DISTINCT FROM 'Open' THEN RAISE EXCEPTION 'Auction is not open'; END IF;
    RETURN NEW;
END;
$$;


--
-- Name: guard_auction_terminal_state(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.guard_auction_terminal_state() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD."Status" IN ('Closed', 'WinnerSelected', 'ClosedNoBids') THEN
        RAISE EXCEPTION 'Closed auction is immutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;


--
-- Name: reject_auction_history_mutation(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.reject_auction_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Auction history is immutable'; END;
$$;


--
-- Name: reject_operational_history_mutation(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.reject_operational_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'Operational contribution history is append-only';
END;
$$;


--
-- Name: reject_schedule_history_mutation(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.reject_schedule_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Auction schedule history is immutable'; END; $$;


--
-- Name: reject_selection_history_mutation(); Type: FUNCTION; Schema: groups; Owner: -
--

CREATE FUNCTION groups.reject_selection_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Completed selection history is immutable'; END;
$$;


--
-- Name: ensure_complete_journal(); Type: FUNCTION; Schema: ledger; Owner: -
--

CREATE FUNCTION ledger.ensure_complete_journal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE target uuid; journal ledger."JournalEntries"%ROWTYPE; line_count bigint; debit numeric; credit numeric;
BEGIN
  IF TG_TABLE_NAME = 'JournalEntries' THEN target := NEW."Id"; ELSE target := NEW."JournalEntryId"; END IF;
  SELECT * INTO STRICT journal FROM ledger."JournalEntries" WHERE "Id" = target FOR UPDATE;
  SELECT count(*), COALESCE(sum("DebitAmount"),0), COALESCE(sum("CreditAmount"),0)
    INTO line_count, debit, credit FROM ledger."JournalLines" WHERE "JournalEntryId" = target;
  IF line_count < 2 OR line_count <> journal."LineCount" OR debit <> credit OR debit <> journal."DebitTotal" OR credit <> journal."CreditTotal" THEN
    RAISE EXCEPTION 'Journal is incomplete or unbalanced' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId"
             WHERE l."JournalEntryId" = target AND NOT a."IsActive") THEN
    RAISE EXCEPTION 'Cannot post to inactive account' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM ledger."JournalLines" a JOIN ledger."JournalLines" b ON a."JournalEntryId" = b."JournalEntryId"
             WHERE a."JournalEntryId" = target AND (a."GroupId" IS DISTINCT FROM b."GroupId" OR a."CycleId" IS DISTINCT FROM b."CycleId")) THEN
    RAISE EXCEPTION 'V1 journal must use one group and cycle scope' USING ERRCODE = '23514';
  END IF;
  IF journal."ReversesJournalEntryId" IS NOT NULL THEN
    IF (SELECT "LineCount" FROM ledger."JournalEntries" WHERE "Id" = journal."ReversesJournalEntryId") <> line_count OR EXISTS (
      SELECT "AccountId", "CreditAmount", "DebitAmount", "Currency", "GroupId", "CycleId", "MembershipId", "SelectionResultId", "AuctionResultId", "ReferenceType", "ReferenceId"
        FROM ledger."JournalLines" WHERE "JournalEntryId" = journal."ReversesJournalEntryId"
      EXCEPT ALL
      SELECT "AccountId", "DebitAmount", "CreditAmount", "Currency", "GroupId", "CycleId", "MembershipId", "SelectionResultId", "AuctionResultId", "ReferenceType", "ReferenceId"
        FROM ledger."JournalLines" WHERE "JournalEntryId" = target) THEN
      RAISE EXCEPTION 'Reversal must exactly negate original lines and preserve references' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;


--
-- Name: reject_history_change(); Type: FUNCTION; Schema: ledger; Owner: -
--

CREATE FUNCTION ledger.reject_history_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Posted ledger history is append-only; use a reversal journal' USING ERRCODE = '23514'; END $$;


--
-- Name: check_contribution_settlement(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.check_contribution_settlement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c groups."Contributions";
BEGIN
    SELECT * INTO c FROM groups."Contributions" WHERE "Id" = NEW."Id";
    IF c."SettledPaymentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments."Payments" p WHERE p."Id" = c."SettledPaymentId" AND p."ContributionId" = c."Id" AND p."SettledAt" IS NOT NULL AND p."RefundedAt" IS NULL AND p."Amount" = c."FinanciallySettledAmount")
    THEN RAISE EXCEPTION 'Contribution requires its settled payment'; END IF;
    IF EXISTS (SELECT 1 FROM payments."Payments" p WHERE p."ContributionId" = c."Id" AND p."SettledAt" IS NOT NULL AND p."RefundedAt" IS NULL AND p."Id" IS DISTINCT FROM c."SettledPaymentId")
    THEN RAISE EXCEPTION 'Contribution settlement cannot be removed without refund'; END IF;
    RETURN NULL;
END; $$;


--
-- Name: check_cycle_finances(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.check_cycle_finances() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE cy groups."MonthlyCycles"; amount numeric; members integer;
BEGIN
    IF TG_TABLE_NAME = 'MonthlyCycles' THEN
        SELECT * INTO cy FROM groups."MonthlyCycles" WHERE "Id" = NEW."Id";
    ELSE
        SELECT * INTO cy FROM groups."MonthlyCycles" WHERE "Id" = NEW."CycleId";
    END IF;
    SELECT COALESCE(sum("FinanciallySettledAmount"),0), count(*) FILTER (WHERE "FinanciallySettledAmount" = "ExpectedAmount") INTO amount,members FROM groups."Contributions" WHERE "CycleId" = cy."Id";
    IF cy."FinanciallySettledAmount" <> amount OR cy."FinanciallySettledMemberCount" <> members OR
        (cy."CollectionMode" = 'Razorpay' AND cy."Status" IN ('ContributionsComplete','ReadyForSelection','SelectionCompleted') AND (amount <> cy."ExpectedPoolAmount" OR members <> cy."ExpectedMemberCount"))
    THEN RAISE EXCEPTION 'Cycle readiness requires exact financial settlement totals'; END IF;
    RETURN NULL;
END; $$;


--
-- Name: check_payment_consistency(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.check_payment_consistency() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p payments."Payments"; c groups."Contributions"; cy groups."MonthlyCycles";
BEGIN
    SELECT * INTO p FROM payments."Payments" WHERE "Id" = NEW."Id";
    SELECT * INTO c FROM groups."Contributions" WHERE "Id" = p."ContributionId";
    SELECT * INTO cy FROM groups."MonthlyCycles" WHERE "Id" = p."CycleId";
    IF ROW(c."GroupId",c."CycleId",c."MembershipId",c."ExpectedAmount") IS DISTINCT FROM ROW(p."GroupId",p."CycleId",p."MembershipId",p."Amount")
        OR cy."CollectionMode" <> 'Razorpay'
        OR NOT EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."Id" = p."MembershipId" AND m."UserId" = p."UserId")
    THEN RAISE EXCEPTION 'Payment source does not match its contribution'; END IF;
    IF p."CapturedAt" IS NOT NULL AND p."SettledAt" IS NULL THEN RAISE EXCEPTION 'Capture and settlement must commit together'; END IF;
    IF p."SettledAt" IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM ledger."JournalEntries" j WHERE j."Id" = p."JournalId" AND j."EventType" = 'PaymentCaptured' AND j."EventId" = p."Id" AND j."DebitTotal" = p."Amount" AND j."LineCount" = 2)
            OR (SELECT count(*) FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId"
                WHERE l."JournalEntryId" = p."JournalId" AND l."PaymentId" = p."Id" AND l."ContributionId" = c."Id" AND l."GroupId" = p."GroupId" AND l."CycleId" = p."CycleId"
                AND ((a."Code" = '1010' AND l."DebitAmount" = p."Amount") OR (a."Code" = '2000' AND l."CreditAmount" = p."Amount"))) <> 2
        THEN RAISE EXCEPTION 'Settlement requires its exact capture journal'; END IF;
        IF p."RefundedAt" IS NULL AND (c."SettledPaymentId" IS DISTINCT FROM p."Id" OR c."FinanciallySettledAmount" <> p."Amount") THEN RAISE EXCEPTION 'Settlement contribution mismatch'; END IF;
    END IF;
    IF p."RefundedAt" IS NOT NULL AND (c."SettledPaymentId" = p."Id" OR NOT EXISTS
        (SELECT 1 FROM ledger."JournalEntries" j WHERE j."Id" = p."ReversalJournalId" AND j."ReversesJournalEntryId" = p."JournalId"))
    THEN RAISE EXCEPTION 'Refund requires a reversing journal and released contribution'; END IF;
    RETURN NULL;
END; $$;


--
-- Name: protect_financial_cycle(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.protect_financial_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW."CollectionMode" IS DISTINCT FROM OLD."CollectionMode" OR
        (OLD."SelectionResultId" IS NOT NULL AND ROW(NEW."FinanciallySettledAmount",NEW."FinanciallySettledMemberCount") IS DISTINCT FROM ROW(OLD."FinanciallySettledAmount",OLD."FinanciallySettledMemberCount"))
    THEN RAISE EXCEPTION 'Cycle collection mode and selected finances are immutable'; END IF;
    RETURN NEW;
END; $$;


--
-- Name: protect_payment(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.protect_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF ROW(NEW."Id",NEW."ContributionId",NEW."GroupId",NEW."CycleId",NEW."MembershipId",NEW."UserId",NEW."Amount",NEW."Currency",NEW."Provider",NEW."Environment",NEW."Receipt",NEW."IdempotencyKey",NEW."AttemptNumber",NEW."CreatedAt",NEW."GroupName",NEW."MemberName",NEW."CycleNumber",NEW."BusinessTimeZone")
        IS DISTINCT FROM ROW(OLD."Id",OLD."ContributionId",OLD."GroupId",OLD."CycleId",OLD."MembershipId",OLD."UserId",OLD."Amount",OLD."Currency",OLD."Provider",OLD."Environment",OLD."Receipt",OLD."IdempotencyKey",OLD."AttemptNumber",OLD."CreatedAt",OLD."GroupName",OLD."MemberName",OLD."CycleNumber",OLD."BusinessTimeZone")
        OR (OLD."ProviderOrderId" IS NOT NULL AND NEW."ProviderOrderId" IS DISTINCT FROM OLD."ProviderOrderId")
        OR (OLD."ProviderPaymentId" IS NOT NULL AND NEW."ProviderPaymentId" IS DISTINCT FROM OLD."ProviderPaymentId")
        OR (OLD."CapturedAt" IS NOT NULL AND NEW."CapturedAt" IS DISTINCT FROM OLD."CapturedAt")
        OR (OLD."SettledAt" IS NOT NULL AND ROW(NEW."SettledAt",NEW."JournalId") IS DISTINCT FROM ROW(OLD."SettledAt",OLD."JournalId"))
        OR (OLD."RefundedAt" IS NOT NULL AND ROW(NEW."RefundedAt",NEW."ReversalJournalId") IS DISTINCT FROM ROW(OLD."RefundedAt",OLD."ReversalJournalId"))
        OR (OLD."CapturedAt" IS NOT NULL AND NEW."Status" NOT IN ('Captured','RefundPending','Refunded','ReconciliationRequired'))
        OR (OLD."Status" = 'Authorized' AND NEW."Status" NOT IN ('Authorized','Captured','ReconciliationRequired'))
        OR (OLD."Status" = 'Refunded' AND NEW."Status" NOT IN ('Refunded','ReconciliationRequired'))
        OR (OLD."Status" = 'ReconciliationRequired' AND NEW."Status" <> 'ReconciliationRequired')
    THEN RAISE EXCEPTION 'Payment identity and completed transitions are immutable'; END IF;
    RETURN NEW;
END; $$;


--
-- Name: reject_history_mutation(); Type: FUNCTION; Schema: payments; Owner: -
--

CREATE FUNCTION payments.reject_history_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Payment history is immutable'; END; $$;


--
-- Name: check_cycle_completion(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.check_cycle_completion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE c groups."MonthlyCycles"; required integer;
BEGIN
  SELECT * INTO c FROM groups."MonthlyCycles" WHERE "Id" = NEW."Id";
  IF c."Status" IN ('PayoutCompleted','Completed') THEN
    SELECT count(*) INTO required FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId"
      JOIN ledger."JournalEntries" j ON j."Id" = l."JournalEntryId"
      WHERE l."CycleId" = c."Id" AND l."SelectionResultId" = c."SelectionResultId" AND l."CreditAmount" > 0 AND a."Code" IN ('2100','2200','2300','4000')
      AND j."EventType" IN ('RandomSelectionCompleted','OrganizerReservedSelectionCompleted','AuctionSelectionCompleted');
    IF required = 0 OR (SELECT count(*) FROM payouts."PayoutObligations" p WHERE p."CycleId" = c."Id" AND p."Status" = 'Succeeded') <> required OR
       EXISTS (SELECT 1 FROM payouts."PayoutObligations" p WHERE p."CycleId" = c."Id" AND p."Status" <> 'Succeeded') OR c."CompletedAt" IS NULL OR c."PayoutCompletedAt" IS NULL THEN RAISE EXCEPTION 'All required cycle allocations must settle first'; END IF;
  END IF;
  IF c."Status" = 'CollectingContributions' AND c."CycleNumber" > 1 AND NOT EXISTS (
    SELECT 1 FROM groups."MonthlyCycles" p WHERE p."GroupId" = c."GroupId" AND p."CycleNumber" = c."CycleNumber" - 1 AND p."Status" = 'Completed') THEN RAISE EXCEPTION 'Previous cycle must complete first'; END IF;
  RETURN NULL;
END $$;


--
-- Name: check_group_completion(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.check_group_completion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE g groups."Groups";
BEGIN
  SELECT * INTO g FROM groups."Groups" WHERE "Id" = NEW."Id";
  IF g."Status" = 'Completed' AND (g."CompletedAt" IS NULL OR g."CurrentCycleNumber" <> g."DurationMonths" OR
    (SELECT count(*) FROM groups."MonthlyCycles" c WHERE c."GroupId" = g."Id" AND c."Status" = 'Completed') <> g."DurationMonths" OR
    (SELECT count(*) FROM groups."GroupMemberships" m WHERE m."GroupId" = g."Id" AND m."SlotNumber" IS NOT NULL) <> g."MemberLimit" OR
    EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."GroupId" = g."Id" AND m."SlotNumber" IS NOT NULL AND
      (NOT m."HasBeenSelectedForPayout" OR (SELECT count(*) FROM groups."SelectionResults" s WHERE s."GroupId" = g."Id" AND s."WinnerMembershipId" = m."Id") <> 1))) THEN RAISE EXCEPTION 'Final group requires every cycle settled and each member selected exactly once'; END IF;
  RETURN NULL;
END $$;


--
-- Name: check_settlement(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.check_settlement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p payouts."PayoutObligations"; code text;
BEGIN
  SELECT * INTO p FROM payouts."PayoutObligations" WHERE "Id" = NEW."Id";
  code := CASE p."PayoutType" WHEN 'WinnerPayout' THEN '2100' WHEN 'MemberAuctionBenefit' THEN '2200' ELSE NULL END;
  IF NOT EXISTS (SELECT 1 FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId"
    WHERE l."JournalEntryId" = p."AllocationJournalId" AND l."GroupId" = p."GroupId" AND l."CycleId" = p."CycleId"
    AND l."SelectionResultId" = p."SelectionResultId" AND l."MembershipId" IS NOT DISTINCT FROM p."MembershipId" AND l."CreditAmount" = p."Amount"
    AND (a."Code" = code OR (code IS NULL AND a."Code" IN ('2300','4000')))) THEN RAISE EXCEPTION 'Payout must match funded allocation journal'; END IF;
  IF p."Status" = 'Succeeded' AND code IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM payouts."PayoutAttempts" a JOIN payouts."PayoutProviderEvents" e ON e."PayoutAttemptId" = a."Id"
      WHERE a."PayoutObligationId" = p."Id" AND e."Matched" AND e."Status" = 'Success') THEN RAISE EXCEPTION 'Reconciled provider success required'; END IF;
    IF NOT EXISTS (SELECT 1 FROM ledger."JournalEntries" j WHERE j."Id" = p."SettlementJournalId" AND j."EventType" = 'PayoutSettled' AND j."EventId" = p."Id" AND j."DebitTotal" = p."Amount" AND j."LineCount" = 2) OR
       NOT EXISTS (SELECT 1 FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId" WHERE l."JournalEntryId" = p."SettlementJournalId" AND a."Code" = code AND l."DebitAmount" = p."Amount" AND l."MembershipId" = p."MembershipId" AND l."ReferenceId" = p."Id") OR
       NOT EXISTS (SELECT 1 FROM ledger."JournalLines" l JOIN ledger."LedgerAccounts" a ON a."Id" = l."AccountId" WHERE l."JournalEntryId" = p."SettlementJournalId" AND a."Code" = '1020' AND l."CreditAmount" = p."Amount") THEN RAISE EXCEPTION 'Exact payout settlement journal required'; END IF;
  ELSIF p."Status" = 'Succeeded' AND p."SettlementJournalId" <> p."AllocationJournalId" THEN RAISE EXCEPTION 'Internal fee uses allocation journal'; END IF;
  RETURN NULL;
END $$;


--
-- Name: guard_attempt(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.guard_attempt() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE p payouts."PayoutObligations"; prev payouts."PayoutAttempts";
BEGIN
  SELECT * INTO p FROM payouts."PayoutObligations" WHERE "Id" = NEW."PayoutObligationId" FOR UPDATE;
  IF p."Status" <> 'Processing' OR p."BeneficiaryId" <> NEW."BeneficiaryId" OR p."Amount" <> NEW."Amount" OR p."Currency" <> NEW."Currency" THEN RAISE EXCEPTION 'Attempt does not match approved processing payout'; END IF;
  IF NOT EXISTS (SELECT 1 FROM payouts."PayoutBeneficiaries" b WHERE b."Id" = NEW."BeneficiaryId" AND b."ProviderFundAccountId" = NEW."ProviderFundAccountId" AND b."MaskedAccountNumber" = NEW."MaskedAccountNumber") THEN RAISE EXCEPTION 'Attempt beneficiary snapshot mismatch'; END IF;
  SELECT * INTO prev FROM payouts."PayoutAttempts" WHERE "PayoutObligationId" = p."Id" ORDER BY "AttemptNumber" DESC LIMIT 1;
  IF NEW."AttemptNumber" <> COALESCE(prev."AttemptNumber",0) + 1 THEN RAISE EXCEPTION 'Invalid attempt sequence'; END IF;
  IF prev."Id" IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM payouts."PayoutProviderEvents" e WHERE e."PayoutAttemptId" = prev."Id" AND e."Matched" AND e."Status" = 'Failed') OR
      EXISTS (SELECT 1 FROM payouts."PayoutProviderEvents" e WHERE e."PayoutAttemptId" = prev."Id" AND (NOT e."Matched" OR e."Status" = 'Success'))) THEN RAISE EXCEPTION 'Only one active payout attempt is allowed'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_completed_cycle(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.guard_completed_cycle() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD."CompletedAt" IS NOT NULL AND ROW(NEW."Status",NEW."CompletedAt",NEW."PayoutCompletedAt") IS DISTINCT FROM ROW(OLD."Status",OLD."CompletedAt",OLD."PayoutCompletedAt") THEN RAISE EXCEPTION 'Completed cycle settlement cannot regress'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_obligation(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.guard_obligation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['Status','BeneficiaryId','ApprovedByUserId','ApprovedAt','SettlementJournalId','SettledAt','UpdatedAt','Version']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['Status','BeneficiaryId','ApprovedByUserId','ApprovedAt','SettlementJournalId','SettledAt','UpdatedAt','Version']) THEN
      RAISE EXCEPTION 'Payout source and amount are immutable';
    END IF;
    IF OLD."ApprovedAt" IS NOT NULL AND ROW(NEW."BeneficiaryId",NEW."ApprovedByUserId",NEW."ApprovedAt") IS DISTINCT FROM ROW(OLD."BeneficiaryId",OLD."ApprovedByUserId",OLD."ApprovedAt") THEN
      RAISE EXCEPTION 'Approved payout destination is immutable';
    END IF;
    IF OLD."Status" IN ('Succeeded','ReconciliationRequired') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal payout or reconciliation hold is immutable'; END IF;
    IF OLD."Status" <> NEW."Status" AND NOT (
      (OLD."Status" IN ('PendingBeneficiary','ApprovalRequired') AND NEW."Status" = 'Approved') OR
      (OLD."Status" IN ('Approved','Failed') AND NEW."Status" = 'Processing') OR
      (OLD."Status" IN ('Processing','ProviderPending') AND NEW."Status" IN ('ProviderPending','Succeeded','Failed','ReconciliationRequired')) OR
      (OLD."Status" = 'Failed' AND NEW."Status" = 'ReconciliationRequired')) THEN RAISE EXCEPTION 'Invalid payout transition'; END IF;
  END IF;
  IF NEW."MembershipId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups."GroupMemberships" m WHERE m."Id" = NEW."MembershipId" AND m."UserId" = NEW."UserId") THEN RAISE EXCEPTION 'Payout recipient mismatch'; END IF;
  IF NEW."ApprovedAt" IS NOT NULL AND (NEW."ApprovedByUserId" = NEW."UserId" OR NOT EXISTS (
    SELECT 1 FROM payouts."PayoutBeneficiaries" b WHERE b."Id" = NEW."BeneficiaryId" AND b."UserId" = NEW."UserId" AND b."AvailableAt" <= NEW."ApprovedAt")) THEN RAISE EXCEPTION 'Invalid payout approval'; END IF;
  RETURN NEW;
END $$;


--
-- Name: guard_provider_event(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.guard_provider_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payouts."PayoutAttempts" a WHERE a."Id" = NEW."PayoutAttemptId" AND a."PayoutObligationId" = NEW."PayoutObligationId" AND a."ProviderPayoutId" = NEW."ProviderPayoutId" AND a."Provider" = NEW."Provider") THEN RAISE EXCEPTION 'Provider event must match its attempt'; END IF;
  RETURN NEW;
END $$;


--
-- Name: reject_history_change(); Type: FUNCTION; Schema: payouts; Owner: -
--

CREATE FUNCTION payouts.reject_history_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION 'Payout history is append-only'; END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __ef_migrations_history; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.__ef_migrations_history (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_logs (
    "Id" uuid NOT NULL,
    "ActorUserId" uuid,
    "Action" character varying(100) NOT NULL,
    "EntityType" character varying(100) NOT NULL,
    "EntityId" character varying(100) NOT NULL,
    "Timestamp" timestamp with time zone NOT NULL,
    "CorrelationId" character varying(100)
);


--
-- Name: AuctionBenefitAllocations; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."AuctionBenefitAllocations" (
    "Id" uuid NOT NULL,
    "AuctionResultId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "MembershipId" uuid,
    "AllocationType" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_AuctionAllocation_Amount" CHECK (("Amount" >= (0)::numeric)),
    CONSTRAINT "CK_AuctionAllocation_Recipient" CHECK (((("AllocationType" = 'MemberBenefit'::text) AND ("MembershipId" IS NOT NULL)) OR (("AllocationType" = 'PlatformFee'::text) AND ("MembershipId" IS NULL))))
);


--
-- Name: AuctionBids; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."AuctionBids" (
    "Id" uuid NOT NULL,
    "AuctionId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "MembershipId" uuid NOT NULL,
    "DiscountAmount" numeric(18,2) NOT NULL,
    "SequenceNumber" bigint NOT NULL,
    "IdempotencyKey" character varying(128) NOT NULL,
    "SubmittedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_AuctionBid_AmountSequence" CHECK ((("DiscountAmount" > (0)::numeric) AND ("SequenceNumber" > 0)))
);


--
-- Name: AuctionResults; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."AuctionResults" (
    "Id" uuid NOT NULL,
    "AuctionId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "SelectionResultId" uuid NOT NULL,
    "WinningBidId" uuid NOT NULL,
    "WinnerMembershipId" uuid NOT NULL,
    "GroupValue" numeric(18,2) NOT NULL,
    "MemberLimit" integer NOT NULL,
    "WinningDiscount" numeric(18,2) NOT NULL,
    "WinnerPayout" numeric(18,2) NOT NULL,
    "GrossMemberShare" numeric(18,2) NOT NULL,
    "PlatformFee" numeric(18,2) NOT NULL,
    "MemberBenefitPool" numeric(18,2) NOT NULL,
    "FeePolicy" text NOT NULL,
    "CalculationVersion" character varying(80) NOT NULL,
    "FinalizedAt" timestamp with time zone NOT NULL,
    "FinalizedByUserId" uuid NOT NULL,
    CONSTRAINT "CK_AuctionResult_Money" CHECK ((("WinningDiscount" > (0)::numeric) AND ("WinnerPayout" > (0)::numeric) AND ("WinnerPayout" < "GroupValue") AND (("WinnerPayout" + "WinningDiscount") = "GroupValue") AND (("MemberLimit" >= 2) AND ("MemberLimit" <= 50)) AND ("GrossMemberShare" > (0)::numeric) AND ("PlatformFee" = "GrossMemberShare") AND (("GrossMemberShare" * ("MemberLimit")::numeric) = "WinningDiscount") AND (("MemberBenefitPool" + "PlatformFee") = "WinningDiscount") AND ("MemberBenefitPool" = ("GrossMemberShare" * (("MemberLimit" - 1))::numeric)))),
    CONSTRAINT "CK_AuctionResult_Version" CHECK (((("CalculationVersion")::text = 'DHANVI_AUCTION_V1'::text) AND ("FeePolicy" = 'WinnerMemberShare'::text)))
);


--
-- Name: AuctionScheduleChanges; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."AuctionScheduleChanges" (
    "Id" uuid NOT NULL,
    "AuctionId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "ChangeSequence" integer NOT NULL,
    "PreviousStartsAt" timestamp with time zone NOT NULL,
    "PreviousEndsAt" timestamp with time zone NOT NULL,
    "NewStartsAt" timestamp with time zone NOT NULL,
    "NewEndsAt" timestamp with time zone NOT NULL,
    "ReasonCode" character varying(40) NOT NULL,
    "ReasonText" character varying(500),
    "MemberMessage" character varying(300),
    "ChangedByUserId" uuid NOT NULL,
    "ChangedByRole" character varying(20) NOT NULL,
    "ChangedAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_AuctionScheduleChange_Reason" CHECK (((("ReasonCode")::text <> 'Other'::text) OR (length(TRIM(BOTH FROM "ReasonText")) >= 5))),
    CONSTRAINT "CK_AuctionScheduleChange_Role" CHECK ((("ChangedByRole")::text = ANY ((ARRAY['ADMIN'::character varying, 'ORGANIZER'::character varying])::text[]))),
    CONSTRAINT "CK_AuctionScheduleChange_Windows" CHECK ((("PreviousStartsAt" < "PreviousEndsAt") AND ("NewStartsAt" < "NewEndsAt") AND ("ChangeSequence" > 0)))
);


--
-- Name: Auctions; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."Auctions" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "CycleNumber" integer NOT NULL,
    "Status" text NOT NULL,
    "StartsAt" timestamp with time zone NOT NULL,
    "EndsAt" timestamp with time zone NOT NULL,
    "GroupValue" numeric(18,2) NOT NULL,
    "MemberLimit" integer NOT NULL,
    "MinimumDiscount" numeric(18,2) NOT NULL,
    "MaximumDiscount" numeric(18,2) NOT NULL,
    "BidIncrement" numeric(18,2) NOT NULL,
    "FeePolicy" text NOT NULL,
    "CurrentHighestDiscount" numeric(18,2) NOT NULL,
    "CurrentWinningBidId" uuid,
    "CurrentWinningMembershipId" uuid,
    "LastBidSequence" bigint NOT NULL,
    "OpenedAt" timestamp with time zone,
    "ClosedAt" timestamp with time zone,
    "WinnerSelectedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "Version" integer NOT NULL,
    "LastRescheduledAt" timestamp with time zone,
    "LatestMemberMessage" character varying(300),
    "LatestReasonCode" character varying(40),
    "OriginalEndsAt" timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    "OriginalStartsAt" timestamp with time zone DEFAULT '-infinity'::timestamp with time zone NOT NULL,
    "PreviousEndsAt" timestamp with time zone,
    "PreviousStartsAt" timestamp with time zone,
    "RescheduleCount" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "CK_Auction_Current" CHECK ((("LastBidSequence" >= 0) AND ("CurrentHighestDiscount" >= (0)::numeric) AND ("CurrentHighestDiscount" <= "MaximumDiscount"))),
    CONSTRAINT "CK_Auction_Rules" CHECK ((("GroupValue" > (0)::numeric) AND (("MemberLimit" >= 2) AND ("MemberLimit" <= 50)) AND (("CycleNumber" >= 1) AND ("CycleNumber" <= 50)) AND ("MinimumDiscount" >= (0)::numeric) AND ("MaximumDiscount" >= "MinimumDiscount") AND ("MaximumDiscount" > (0)::numeric) AND ("MaximumDiscount" < "GroupValue") AND ("BidIncrement" > (0)::numeric) AND ("StartsAt" < "EndsAt")))
);


--
-- Name: ContributionEntries; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."ContributionEntries" (
    "Id" uuid NOT NULL,
    "ContributionId" uuid NOT NULL,
    "EntryType" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Reference" character varying(200) NOT NULL,
    "IdempotencyKey" character varying(200) NOT NULL,
    "RecordedByUserId" uuid NOT NULL,
    "Note" character varying(1000),
    "CreatedAt" timestamp with time zone NOT NULL,
    "ReversesEntryId" uuid,
    CONSTRAINT "CK_Entry_Amount" CHECK (("Amount" > (0)::numeric)),
    CONSTRAINT "CK_Entry_Reversal" CHECK (((("EntryType" = 'Record'::text) AND ("ReversesEntryId" IS NULL)) OR (("EntryType" = 'Reversal'::text) AND ("ReversesEntryId" IS NOT NULL))))
);


--
-- Name: Contributions; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."Contributions" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "MembershipId" uuid NOT NULL,
    "ExpectedAmount" numeric(18,2) NOT NULL,
    "RecordedAmount" numeric(18,2) NOT NULL,
    "Status" text NOT NULL,
    "DueDate" date NOT NULL,
    "RecordedAt" timestamp with time zone,
    "OverdueAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "Version" integer NOT NULL,
    "FinancialStatus" text DEFAULT 'Unpaid'::text NOT NULL,
    "FinanciallySettledAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "SettledPaymentId" uuid,
    CONSTRAINT "CK_Contribution_Amounts" CHECK ((("ExpectedAmount" > (0)::numeric) AND (("RecordedAmount" >= (0)::numeric) AND ("RecordedAmount" <= "ExpectedAmount")))),
    CONSTRAINT "CK_Contribution_Financial" CHECK (((("FinanciallySettledAmount" = (0)::numeric) AND ("SettledPaymentId" IS NULL) AND ("FinancialStatus" = ANY (ARRAY['Unpaid'::text, 'Refunded'::text]))) OR (("FinanciallySettledAmount" = "ExpectedAmount") AND ("SettledPaymentId" IS NOT NULL) AND ("FinancialStatus" = 'Settled'::text))))
);


--
-- Name: GroupAuditEvents; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."GroupAuditEvents" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "ActorUserId" uuid NOT NULL,
    "Action" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "SubjectId" uuid,
    "AlgorithmVersion" character varying(80),
    "CycleId" uuid,
    "SelectionResultId" uuid,
    "WinnerMembershipId" uuid
);


--
-- Name: GroupMemberships; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."GroupMemberships" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "SlotNumber" integer,
    "Status" text NOT NULL,
    "AppliedAt" timestamp with time zone NOT NULL,
    "ApprovedAt" timestamp with time zone,
    "RejectedAt" timestamp with time zone,
    "RejectedReason" text,
    "TermsVersionId" uuid,
    "TermsAcceptedAt" timestamp with time zone,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "HasBeenSelectedForPayout" boolean NOT NULL,
    "PayoutCycleNumber" integer,
    CONSTRAINT "CK_Membership_Slot" CHECK ((("SlotNumber" IS NULL) OR (("SlotNumber" >= 1) AND ("SlotNumber" <= 50))))
);


--
-- Name: GroupRuleVersions; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."GroupRuleVersions" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "VersionNumber" integer NOT NULL,
    "RulesSnapshot" text NOT NULL,
    "RulesHash" character varying(64) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "CreatedByUserId" uuid NOT NULL
);


--
-- Name: GroupTermsAcceptances; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."GroupTermsAcceptances" (
    "Id" uuid NOT NULL,
    "MembershipId" uuid NOT NULL,
    "GroupRuleVersionId" uuid NOT NULL,
    "AcceptedAt" timestamp with time zone NOT NULL,
    "RulesHash" character varying(64) NOT NULL
);


--
-- Name: Groups; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."Groups" (
    "Id" uuid NOT NULL,
    "Name" character varying(200) NOT NULL,
    "Description" character varying(4000) NOT NULL,
    "CreatorType" text NOT NULL,
    "CreatedByUserId" uuid NOT NULL,
    "Rules" jsonb NOT NULL,
    "GroupType" text NOT NULL,
    "GroupValue" numeric(18,2) NOT NULL,
    "MemberLimit" integer NOT NULL,
    "MonthlyContribution" numeric(18,2) NOT NULL,
    "DurationMonths" integer NOT NULL,
    "Status" text NOT NULL,
    "CurrentMemberCount" integer NOT NULL,
    "RulesLocked" boolean NOT NULL,
    "RulesVersion" integer NOT NULL,
    "Version" integer NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "PublishedAt" timestamp with time zone,
    "StatusReason" text,
    "ActivatedAt" timestamp with time zone,
    "CurrentCycleNumber" integer,
    "GroupTimeZone" character varying(100) DEFAULT 'Asia/Kolkata'::character varying NOT NULL,
    "CompletedAt" timestamp with time zone,
    CONSTRAINT "CK_Group_Capacity" CHECK ((("CurrentMemberCount" >= 0) AND ("CurrentMemberCount" <= (("Rules" ->> 'MemberLimit'::text))::integer))),
    CONSTRAINT "CK_Group_Rules" CHECK (((((("Rules" ->> 'MemberLimit'::text))::integer >= 2) AND ((("Rules" ->> 'MemberLimit'::text))::integer <= 50)) AND ((("Rules" ->> 'GroupValue'::text))::numeric > (0)::numeric) AND ("DurationMonths" = (("Rules" ->> 'MemberLimit'::text))::integer) AND (("MonthlyContribution" * ("DurationMonths")::numeric) = (("Rules" ->> 'GroupValue'::text))::numeric)))
);


--
-- Name: IdempotencyRecords; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."IdempotencyRecords" (
    "Id" uuid NOT NULL,
    "Scope" character varying(100) NOT NULL,
    "Key" character varying(200) NOT NULL,
    "RequestHash" character varying(64) NOT NULL,
    "ResultId" uuid NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: MonthlyCycles; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."MonthlyCycles" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleNumber" integer NOT NULL,
    "SelectionMethod" text NOT NULL,
    "ContributionDueDate" date NOT NULL,
    "SelectionDate" date NOT NULL,
    "PayoutDate" date NOT NULL,
    "ExpectedMemberCount" integer NOT NULL,
    "ExpectedContributionPerMember" numeric(18,2) NOT NULL,
    "ExpectedPoolAmount" numeric(18,2) NOT NULL,
    "RecordedContributionAmount" numeric(18,2) NOT NULL,
    "FullyRecordedMemberCount" integer NOT NULL,
    "Status" text NOT NULL,
    "StartedAt" timestamp with time zone,
    "ContributionsCompletedAt" timestamp with time zone,
    "ReadyForSelectionAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "Version" integer NOT NULL,
    "SelectionCompletedAt" timestamp with time zone,
    "SelectionResultId" uuid,
    "CollectionMode" text DEFAULT 'ManualTracking'::text NOT NULL,
    "FinanciallySettledAmount" numeric(18,2) DEFAULT 0.0 NOT NULL,
    "FinanciallySettledMemberCount" integer DEFAULT 0 NOT NULL,
    "CompletedAt" timestamp with time zone,
    "PayoutCompletedAt" timestamp with time zone,
    CONSTRAINT "CK_Cycle_Dates" CHECK ((("ContributionDueDate" <= "SelectionDate") AND ("SelectionDate" <= "PayoutDate"))),
    CONSTRAINT "CK_Cycle_Expected" CHECK (((("CycleNumber" >= 1) AND ("CycleNumber" <= "ExpectedMemberCount")) AND (("ExpectedMemberCount" >= 2) AND ("ExpectedMemberCount" <= 50)) AND ("ExpectedContributionPerMember" > (0)::numeric) AND ("ExpectedPoolAmount" = ("ExpectedContributionPerMember" * ("ExpectedMemberCount")::numeric)))),
    CONSTRAINT "CK_Cycle_Financial" CHECK (((("FinanciallySettledAmount" >= (0)::numeric) AND ("FinanciallySettledAmount" <= "ExpectedPoolAmount")) AND (("FinanciallySettledMemberCount" >= 0) AND ("FinanciallySettledMemberCount" <= "ExpectedMemberCount")))),
    CONSTRAINT "CK_Cycle_Totals" CHECK (((("RecordedContributionAmount" >= (0)::numeric) AND ("RecordedContributionAmount" <= "ExpectedPoolAmount")) AND (("FullyRecordedMemberCount" >= 0) AND ("FullyRecordedMemberCount" <= "ExpectedMemberCount"))))
);


--
-- Name: SelectionEligibleMembers; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."SelectionEligibleMembers" (
    "SelectionResultId" uuid NOT NULL,
    "MembershipId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "SlotNumber" integer NOT NULL,
    "Ordinal" integer NOT NULL,
    CONSTRAINT "CK_Eligible_Ordinal" CHECK (((("Ordinal" >= 0) AND ("Ordinal" <= 49)) AND (("SlotNumber" >= 1) AND ("SlotNumber" <= 50))))
);


--
-- Name: SelectionResults; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."SelectionResults" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "CycleNumber" integer NOT NULL,
    "SelectionMethod" text NOT NULL,
    "WinnerMembershipId" uuid NOT NULL,
    "WinnerUserId" uuid NOT NULL,
    "WinnerSlotNumber" integer NOT NULL,
    "EligibleMemberCount" integer NOT NULL,
    "ExecutedAt" timestamp with time zone NOT NULL,
    "ExecutedByUserId" uuid NOT NULL,
    "AlgorithmVersion" character varying(80) NOT NULL,
    "RandomSourceType" character varying(80),
    "SeedCommitment" character varying(64),
    "SeedReveal" character varying(64),
    "EligibleSetHash" character varying(64),
    "ResultHash" character varying(64) NOT NULL,
    "SelectedIndex" integer,
    CONSTRAINT "CK_Selection_Count" CHECK (((("EligibleMemberCount" >= 1) AND ("EligibleMemberCount" <= 50)) AND (("CycleNumber" >= 1) AND ("CycleNumber" <= 50)) AND (("WinnerSlotNumber" >= 1) AND ("WinnerSlotNumber" <= 50)))),
    CONSTRAINT "CK_Selection_Method" CHECK (((("SelectionMethod" = 'Random'::text) AND ("SelectedIndex" IS NOT NULL) AND ("SelectedIndex" >= 0) AND ("SelectedIndex" < "EligibleMemberCount") AND ("SeedReveal" IS NOT NULL) AND ("SeedCommitment" IS NOT NULL) AND ("EligibleSetHash" IS NOT NULL)) OR (("SelectionMethod" = 'OrganizerReserved'::text) AND ("CycleNumber" = 1) AND ("EligibleMemberCount" = 1) AND ("SelectedIndex" IS NULL) AND ("SeedReveal" IS NULL) AND ("SeedCommitment" IS NULL) AND ("EligibleSetHash" IS NULL)) OR (("SelectionMethod" = 'Auction'::text) AND ("SelectedIndex" IS NULL) AND ("SeedReveal" IS NULL) AND ("SeedCommitment" IS NULL) AND ("EligibleSetHash" IS NULL) AND (("AlgorithmVersion")::text = 'DHANVI_AUCTION_V1'::text))))
);


--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: groups; Owner: -
--

CREATE TABLE groups."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: __ef_migrations_history; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.__ef_migrations_history (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: email_verification_tokens; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.email_verification_tokens (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "TokenHash" character varying(64) NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    "UsedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: password_reset_tokens; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.password_reset_tokens (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "TokenHash" character varying(64) NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    "UsedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.refresh_tokens (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "TokenHash" character varying(64) NOT NULL,
    "ExpiresAt" timestamp with time zone NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "RevokedAt" timestamp with time zone,
    "ReplacedByTokenId" uuid,
    "CreatedByIp" character varying(64),
    "RevokedByIp" character varying(64)
);


--
-- Name: roles; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.roles (
    "Id" uuid NOT NULL,
    "Name" character varying(50) NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_roles (
    "UserId" uuid NOT NULL,
    "RoleId" uuid NOT NULL,
    "AssignedAt" timestamp with time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.users (
    "Id" uuid NOT NULL,
    "FirstName" character varying(100) NOT NULL,
    "LastName" character varying(100) NOT NULL,
    "Email" character varying(320) NOT NULL,
    "NormalizedEmail" character varying(320) NOT NULL,
    "PhoneNumber" character varying(32),
    "PasswordHash" character varying(1000) NOT NULL,
    "EmailVerified" boolean NOT NULL,
    "PhoneVerified" boolean NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "LastLoginAt" timestamp with time zone
);


--
-- Name: JournalEntries; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger."JournalEntries" (
    "Id" uuid NOT NULL,
    "JournalNumber" character varying(40) NOT NULL,
    "EventType" character varying(80) NOT NULL,
    "EventId" uuid NOT NULL,
    "Description" character varying(1000) NOT NULL,
    "BusinessDate" date NOT NULL,
    "BusinessTimeZone" character varying(100) NOT NULL,
    "PostedAt" timestamp with time zone NOT NULL,
    "PostedBy" uuid NOT NULL,
    "Status" character varying(20) NOT NULL,
    "CorrelationId" character varying(100),
    "IdempotencyKey" character varying(128) NOT NULL,
    "SourceModule" character varying(80) NOT NULL,
    "SourceFingerprint" character varying(64) NOT NULL,
    "PolicyVersion" character varying(40) NOT NULL,
    "FeePolicy" character varying(40) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "ReversesJournalEntryId" uuid,
    "ReversalReason" character varying(1000),
    "LineCount" integer NOT NULL,
    "DebitTotal" numeric(18,2) NOT NULL,
    "CreditTotal" numeric(18,2) NOT NULL,
    CONSTRAINT "CK_Journal_Posted" CHECK (((("Status")::text = 'POSTED'::text) AND ("LineCount" >= 2) AND ("DebitTotal" > (0)::numeric) AND ("DebitTotal" = "CreditTotal"))),
    CONSTRAINT "CK_Journal_Reversal" CHECK ((((("EventType")::text = 'AccountingReversal'::text) AND ("ReversesJournalEntryId" IS NOT NULL) AND (length(TRIM(BOTH FROM "ReversalReason")) > 0)) OR ((("EventType")::text <> 'AccountingReversal'::text) AND ("ReversesJournalEntryId" IS NULL))))
);


--
-- Name: JournalLines; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger."JournalLines" (
    "Id" uuid NOT NULL,
    "JournalEntryId" uuid NOT NULL,
    "AccountId" uuid NOT NULL,
    "DebitAmount" numeric(18,2) NOT NULL,
    "CreditAmount" numeric(18,2) NOT NULL,
    "Currency" character varying(3) NOT NULL,
    "GroupId" uuid,
    "CycleId" uuid,
    "MembershipId" uuid,
    "SelectionResultId" uuid,
    "AuctionResultId" uuid,
    "ReferenceType" character varying(80) NOT NULL,
    "ReferenceId" uuid NOT NULL,
    "Description" character varying(500) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "ContributionId" uuid,
    "PaymentId" uuid,
    CONSTRAINT "CK_Line_Currency" CHECK ((("Currency")::text = 'INR'::text)),
    CONSTRAINT "CK_Line_Dimensions" CHECK (((("CycleId" IS NULL) AND ("MembershipId" IS NULL) AND ("SelectionResultId" IS NULL) AND ("AuctionResultId" IS NULL)) OR ("GroupId" IS NOT NULL))),
    CONSTRAINT "CK_Line_Sides" CHECK (((("DebitAmount" > (0)::numeric) AND ("CreditAmount" = (0)::numeric)) OR (("CreditAmount" > (0)::numeric) AND ("DebitAmount" = (0)::numeric))))
);


--
-- Name: JournalNumberSequence; Type: SEQUENCE; Schema: ledger; Owner: -
--

CREATE SEQUENCE ledger."JournalNumberSequence"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: LedgerAccounts; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger."LedgerAccounts" (
    "Id" uuid NOT NULL,
    "Code" character varying(20) NOT NULL,
    "Name" character varying(160) NOT NULL,
    "AccountType" text NOT NULL,
    "NormalBalance" text NOT NULL,
    "IsSystem" boolean NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_Account_Normal" CHECK (((("AccountType" = ANY (ARRAY['Asset'::text, 'Expense'::text])) AND ("NormalBalance" = 'Debit'::text)) OR (("AccountType" = ANY (ARRAY['Liability'::text, 'Equity'::text, 'Revenue'::text])) AND ("NormalBalance" = 'Credit'::text)))),
    CONSTRAINT "CK_Account_Type" CHECK (("AccountType" = ANY (ARRAY['Asset'::text, 'Liability'::text, 'Equity'::text, 'Revenue'::text, 'Expense'::text])))
);


--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: ledger; Owner: -
--

CREATE TABLE ledger."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: __ef_migrations_history; Type: TABLE; Schema: organizers; Owner: -
--

CREATE TABLE organizers.__ef_migrations_history (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: organizer_applications; Type: TABLE; Schema: organizers; Owner: -
--

CREATE TABLE organizers.organizer_applications (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Status" character varying(30) NOT NULL,
    "FullLegalName" character varying(200),
    "Phone" character varying(32),
    "Address" character varying(500) NOT NULL,
    "City" character varying(100) NOT NULL,
    "State" character varying(100) NOT NULL,
    "PostalCode" character varying(20) NOT NULL,
    "ReasonForBecomingOrganizer" character varying(1000) NOT NULL,
    "ExperienceDescription" character varying(2000),
    "SubmittedAt" timestamp with time zone NOT NULL,
    "ReviewedAt" timestamp with time zone,
    "ReviewedByUserId" uuid,
    "RejectionReason" character varying(1000)
);


--
-- Name: organizer_profiles; Type: TABLE; Schema: organizers; Owner: -
--

CREATE TABLE organizers.organizer_profiles (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Status" character varying(30) NOT NULL,
    "ApprovedAt" timestamp with time zone,
    "ApprovedByUserId" uuid,
    "SuspendedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL
);


--
-- Name: PaymentHistory; Type: TABLE; Schema: payments; Owner: -
--

CREATE TABLE payments."PaymentHistory" (
    "Id" uuid NOT NULL,
    "PaymentId" uuid NOT NULL,
    "ActorId" uuid NOT NULL,
    "Action" text NOT NULL,
    "Message" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: PaymentProviderEvents; Type: TABLE; Schema: payments; Owner: -
--

CREATE TABLE payments."PaymentProviderEvents" (
    "Id" uuid NOT NULL,
    "Provider" text NOT NULL,
    "EventKey" character varying(200) NOT NULL,
    "EventType" text NOT NULL,
    "PayloadHash" character varying(64) NOT NULL,
    "ProviderOrderId" text,
    "ProviderPaymentId" text,
    "PaymentId" uuid,
    "ReceivedAt" timestamp with time zone NOT NULL,
    "ProcessedAt" timestamp with time zone NOT NULL,
    "ProcessingStatus" text NOT NULL
);


--
-- Name: PaymentRefunds; Type: TABLE; Schema: payments; Owner: -
--

CREATE TABLE payments."PaymentRefunds" (
    "Id" uuid NOT NULL,
    "PaymentId" uuid NOT NULL,
    "ProviderRefundId" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Status" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_Refund_State" CHECK ((("Amount" > (0)::numeric) AND (length(TRIM(BOTH FROM "ProviderRefundId")) > 0) AND ("Status" = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text]))))
);


--
-- Name: Payments; Type: TABLE; Schema: payments; Owner: -
--

CREATE TABLE payments."Payments" (
    "Id" uuid NOT NULL,
    "ContributionId" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "CycleId" uuid NOT NULL,
    "MembershipId" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "GroupName" text NOT NULL,
    "MemberName" text NOT NULL,
    "CycleNumber" integer NOT NULL,
    "BusinessTimeZone" text NOT NULL,
    "Provider" text NOT NULL,
    "Environment" text NOT NULL,
    "ProviderOrderId" character varying(100),
    "ProviderPaymentId" character varying(100),
    "Amount" numeric(18,2) NOT NULL,
    "Currency" text NOT NULL,
    "Status" text NOT NULL,
    "AttemptNumber" integer NOT NULL,
    "IdempotencyKey" character varying(200) NOT NULL,
    "Receipt" character varying(40) NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "AuthorizedAt" timestamp with time zone,
    "CapturedAt" timestamp with time zone,
    "FailedAt" timestamp with time zone,
    "RefundedAt" timestamp with time zone,
    "SettledAt" timestamp with time zone,
    "JournalId" uuid,
    "ReversalJournalId" uuid,
    "FailureCode" text,
    "FailureReason" text,
    "ReconciliationStatus" text NOT NULL,
    "LastReconciledAt" timestamp with time zone,
    "ReconciliationMessage" text,
    "Version" integer NOT NULL,
    CONSTRAINT "CK_Payment_Money" CHECK ((("Amount" > (0)::numeric) AND ("Currency" = 'INR'::text) AND ("Environment" = 'TEST'::text) AND ("Provider" = 'RAZORPAY'::text))),
    CONSTRAINT "CK_Payment_Settled" CHECK ((("SettledAt" IS NULL) OR (("CapturedAt" IS NOT NULL) AND ("JournalId" IS NOT NULL) AND ("ProviderPaymentId" IS NOT NULL)))),
    CONSTRAINT "CK_Payment_State" CHECK ((("Status" = ANY (ARRAY['Created'::text, 'Pending'::text, 'Authorized'::text, 'Captured'::text, 'Failed'::text, 'Cancelled'::text, 'RefundPending'::text, 'Refunded'::text, 'ReconciliationRequired'::text])) AND ("AttemptNumber" > 0) AND (length(TRIM(BOTH FROM "IdempotencyKey")) > 0) AND (("Status" <> ALL (ARRAY['Authorized'::text, 'Captured'::text, 'RefundPending'::text, 'Refunded'::text])) OR ("ProviderPaymentId" IS NOT NULL)) AND (("Status" <> ALL (ARRAY['Captured'::text, 'RefundPending'::text, 'Refunded'::text])) OR ("CapturedAt" IS NOT NULL)) AND ((("RefundedAt" IS NULL) AND ("ReversalJournalId" IS NULL)) OR (("RefundedAt" IS NOT NULL) AND ("ReversalJournalId" IS NOT NULL) AND ("SettledAt" IS NOT NULL)))))
);


--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: payments; Owner: -
--

CREATE TABLE payments."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: FakeProviderPayouts; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."FakeProviderPayouts" (
    "Id" text NOT NULL,
    "IdempotencyKey" text NOT NULL,
    "FundAccountId" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Currency" text NOT NULL,
    "Reference" text NOT NULL,
    "Status" text NOT NULL,
    "Revision" integer NOT NULL
);


--
-- Name: PayoutAttempts; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."PayoutAttempts" (
    "Id" uuid NOT NULL,
    "PayoutObligationId" uuid NOT NULL,
    "AttemptNumber" integer NOT NULL,
    "Provider" text NOT NULL,
    "ProviderPayoutId" text NOT NULL,
    "IdempotencyKey" text NOT NULL,
    "RequestKey" text NOT NULL,
    "BeneficiaryId" uuid NOT NULL,
    "ProviderFundAccountId" text NOT NULL,
    "MaskedAccountNumber" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Currency" text NOT NULL,
    "RequestedAt" timestamp with time zone NOT NULL,
    "CreatedByUserId" uuid NOT NULL,
    CONSTRAINT "CK_Attempt_Money" CHECK ((("Amount" > (0)::numeric) AND ("Currency" = 'INR'::text) AND ("Provider" = 'FAKE'::text)))
);


--
-- Name: PayoutBeneficiaries; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."PayoutBeneficiaries" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "Provider" text NOT NULL,
    "ProviderFundAccountId" text NOT NULL,
    "AccountType" text NOT NULL,
    "MaskedAccountNumber" character varying(8) NOT NULL,
    "AccountHolderName" text NOT NULL,
    "BankName" text NOT NULL,
    "Ifsc" character varying(11) NOT NULL,
    "Status" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL,
    "AvailableAt" timestamp with time zone NOT NULL,
    CONSTRAINT "CK_Beneficiary_Masked" CHECK (((("MaskedAccountNumber")::text ~ '^\*{4}[0-9]{4}$'::text) AND (("Ifsc")::text ~ '^[A-Z]{4}0[A-Z0-9]{6}$'::text) AND ("Provider" = 'FAKE'::text)))
);


--
-- Name: PayoutObligations; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."PayoutObligations" (
    "Id" uuid NOT NULL,
    "GroupId" uuid NOT NULL,
    "GroupName" text NOT NULL,
    "CycleId" uuid NOT NULL,
    "CycleNumber" integer NOT NULL,
    "MembershipId" uuid,
    "UserId" uuid,
    "MemberName" text NOT NULL,
    "SelectionResultId" uuid NOT NULL,
    "AuctionResultId" uuid,
    "SourceId" uuid NOT NULL,
    "PayoutType" text NOT NULL,
    "Amount" numeric(18,2) NOT NULL,
    "Currency" text NOT NULL,
    "TimeZone" text NOT NULL,
    "Status" text NOT NULL,
    "BeneficiaryId" uuid,
    "ApprovedByUserId" uuid,
    "ApprovedAt" timestamp with time zone,
    "AllocationJournalId" uuid NOT NULL,
    "SettlementJournalId" uuid,
    "CreatedAt" timestamp with time zone NOT NULL,
    "UpdatedAt" timestamp with time zone NOT NULL,
    "SettledAt" timestamp with time zone,
    "Version" integer NOT NULL,
    CONSTRAINT "CK_Payout_Money" CHECK ((("Amount" > (0)::numeric) AND ("Currency" = 'INR'::text))),
    CONSTRAINT "CK_Payout_Recipient" CHECK (((("PayoutType" = 'PlatformFeeSettlement'::text) AND ("UserId" IS NULL) AND ("MembershipId" IS NULL)) OR (("PayoutType" = ANY (ARRAY['WinnerPayout'::text, 'MemberAuctionBenefit'::text])) AND ("UserId" IS NOT NULL) AND ("MembershipId" IS NOT NULL)))),
    CONSTRAINT "CK_Payout_Settled" CHECK ((("Status" = 'Succeeded'::text) = (("SettledAt" IS NOT NULL) AND ("SettlementJournalId" IS NOT NULL))))
);


--
-- Name: PayoutProviderEvents; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."PayoutProviderEvents" (
    "Id" uuid NOT NULL,
    "PayoutObligationId" uuid NOT NULL,
    "PayoutAttemptId" uuid NOT NULL,
    "Provider" text NOT NULL,
    "ProviderPayoutId" text NOT NULL,
    "ProviderEventId" text NOT NULL,
    "PayloadHash" character varying(64) NOT NULL,
    "Status" text NOT NULL,
    "Matched" boolean NOT NULL,
    "ReceivedAt" timestamp with time zone NOT NULL
);


--
-- Name: PayoutReconciliationHistory; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."PayoutReconciliationHistory" (
    "Id" uuid NOT NULL,
    "PayoutObligationId" uuid NOT NULL,
    "ActorUserId" uuid NOT NULL,
    "Action" text NOT NULL,
    "Message" text NOT NULL,
    "CreatedAt" timestamp with time zone NOT NULL
);


--
-- Name: __EFMigrationsHistory; Type: TABLE; Schema: payouts; Owner: -
--

CREATE TABLE payouts."__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL
);


--
-- Name: __ef_migrations_history PK___ef_migrations_history; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.__ef_migrations_history
    ADD CONSTRAINT "PK___ef_migrations_history" PRIMARY KEY ("MigrationId");


--
-- Name: audit_logs PK_audit_logs; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_logs
    ADD CONSTRAINT "PK_audit_logs" PRIMARY KEY ("Id");


--
-- Name: AuctionBids AK_AuctionBids_Id_AuctionId_MembershipId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBids"
    ADD CONSTRAINT "AK_AuctionBids_Id_AuctionId_MembershipId" UNIQUE ("Id", "AuctionId", "MembershipId");


--
-- Name: AuctionResults AK_AuctionResults_Id_GroupId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "AK_AuctionResults_Id_GroupId" UNIQUE ("Id", "GroupId");


--
-- Name: Auctions AK_Auctions_Id_GroupId_CycleId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Auctions"
    ADD CONSTRAINT "AK_Auctions_Id_GroupId_CycleId" UNIQUE ("Id", "GroupId", "CycleId");


--
-- Name: ContributionEntries AK_ContributionEntries_Id_ContributionId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."ContributionEntries"
    ADD CONSTRAINT "AK_ContributionEntries_Id_ContributionId" UNIQUE ("Id", "ContributionId");


--
-- Name: GroupMemberships AK_GroupMemberships_Id_GroupId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "AK_GroupMemberships_Id_GroupId" UNIQUE ("Id", "GroupId");


--
-- Name: GroupMemberships AK_GroupMemberships_Id_UserId_GroupId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "AK_GroupMemberships_Id_UserId_GroupId" UNIQUE ("Id", "UserId", "GroupId");


--
-- Name: MonthlyCycles AK_MonthlyCycles_Id_GroupId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."MonthlyCycles"
    ADD CONSTRAINT "AK_MonthlyCycles_Id_GroupId" UNIQUE ("Id", "GroupId");


--
-- Name: SelectionResults AK_SelectionResults_Id_GroupId; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionResults"
    ADD CONSTRAINT "AK_SelectionResults_Id_GroupId" UNIQUE ("Id", "GroupId");


--
-- Name: AuctionBenefitAllocations PK_AuctionBenefitAllocations; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBenefitAllocations"
    ADD CONSTRAINT "PK_AuctionBenefitAllocations" PRIMARY KEY ("Id");


--
-- Name: AuctionBids PK_AuctionBids; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBids"
    ADD CONSTRAINT "PK_AuctionBids" PRIMARY KEY ("Id");


--
-- Name: AuctionResults PK_AuctionResults; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "PK_AuctionResults" PRIMARY KEY ("Id");


--
-- Name: AuctionScheduleChanges PK_AuctionScheduleChanges; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionScheduleChanges"
    ADD CONSTRAINT "PK_AuctionScheduleChanges" PRIMARY KEY ("Id");


--
-- Name: Auctions PK_Auctions; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Auctions"
    ADD CONSTRAINT "PK_Auctions" PRIMARY KEY ("Id");


--
-- Name: ContributionEntries PK_ContributionEntries; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."ContributionEntries"
    ADD CONSTRAINT "PK_ContributionEntries" PRIMARY KEY ("Id");


--
-- Name: Contributions PK_Contributions; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Contributions"
    ADD CONSTRAINT "PK_Contributions" PRIMARY KEY ("Id");


--
-- Name: GroupAuditEvents PK_GroupAuditEvents; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupAuditEvents"
    ADD CONSTRAINT "PK_GroupAuditEvents" PRIMARY KEY ("Id");


--
-- Name: GroupMemberships PK_GroupMemberships; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "PK_GroupMemberships" PRIMARY KEY ("Id");


--
-- Name: GroupRuleVersions PK_GroupRuleVersions; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupRuleVersions"
    ADD CONSTRAINT "PK_GroupRuleVersions" PRIMARY KEY ("Id");


--
-- Name: GroupTermsAcceptances PK_GroupTermsAcceptances; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupTermsAcceptances"
    ADD CONSTRAINT "PK_GroupTermsAcceptances" PRIMARY KEY ("Id");


--
-- Name: Groups PK_Groups; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Groups"
    ADD CONSTRAINT "PK_Groups" PRIMARY KEY ("Id");


--
-- Name: IdempotencyRecords PK_IdempotencyRecords; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."IdempotencyRecords"
    ADD CONSTRAINT "PK_IdempotencyRecords" PRIMARY KEY ("Id");


--
-- Name: MonthlyCycles PK_MonthlyCycles; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."MonthlyCycles"
    ADD CONSTRAINT "PK_MonthlyCycles" PRIMARY KEY ("Id");


--
-- Name: SelectionEligibleMembers PK_SelectionEligibleMembers; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionEligibleMembers"
    ADD CONSTRAINT "PK_SelectionEligibleMembers" PRIMARY KEY ("SelectionResultId", "MembershipId");


--
-- Name: SelectionResults PK_SelectionResults; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionResults"
    ADD CONSTRAINT "PK_SelectionResults" PRIMARY KEY ("Id");


--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."__EFMigrationsHistory"
    ADD CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId");


--
-- Name: __ef_migrations_history PK___ef_migrations_history; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.__ef_migrations_history
    ADD CONSTRAINT "PK___ef_migrations_history" PRIMARY KEY ("MigrationId");


--
-- Name: email_verification_tokens PK_email_verification_tokens; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.email_verification_tokens
    ADD CONSTRAINT "PK_email_verification_tokens" PRIMARY KEY ("Id");


--
-- Name: password_reset_tokens PK_password_reset_tokens; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.password_reset_tokens
    ADD CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("Id");


--
-- Name: refresh_tokens PK_refresh_tokens; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("Id");


--
-- Name: roles PK_roles; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.roles
    ADD CONSTRAINT "PK_roles" PRIMARY KEY ("Id");


--
-- Name: user_roles PK_user_roles; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_roles
    ADD CONSTRAINT "PK_user_roles" PRIMARY KEY ("UserId", "RoleId");


--
-- Name: users PK_users; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.users
    ADD CONSTRAINT "PK_users" PRIMARY KEY ("Id");


--
-- Name: JournalEntries PK_JournalEntries; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalEntries"
    ADD CONSTRAINT "PK_JournalEntries" PRIMARY KEY ("Id");


--
-- Name: JournalLines PK_JournalLines; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "PK_JournalLines" PRIMARY KEY ("Id");


--
-- Name: LedgerAccounts PK_LedgerAccounts; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."LedgerAccounts"
    ADD CONSTRAINT "PK_LedgerAccounts" PRIMARY KEY ("Id");


--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."__EFMigrationsHistory"
    ADD CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId");


--
-- Name: __ef_migrations_history PK___ef_migrations_history; Type: CONSTRAINT; Schema: organizers; Owner: -
--

ALTER TABLE ONLY organizers.__ef_migrations_history
    ADD CONSTRAINT "PK___ef_migrations_history" PRIMARY KEY ("MigrationId");


--
-- Name: organizer_applications PK_organizer_applications; Type: CONSTRAINT; Schema: organizers; Owner: -
--

ALTER TABLE ONLY organizers.organizer_applications
    ADD CONSTRAINT "PK_organizer_applications" PRIMARY KEY ("Id");


--
-- Name: organizer_profiles PK_organizer_profiles; Type: CONSTRAINT; Schema: organizers; Owner: -
--

ALTER TABLE ONLY organizers.organizer_profiles
    ADD CONSTRAINT "PK_organizer_profiles" PRIMARY KEY ("Id");


--
-- Name: PaymentHistory PK_PaymentHistory; Type: CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentHistory"
    ADD CONSTRAINT "PK_PaymentHistory" PRIMARY KEY ("Id");


--
-- Name: PaymentProviderEvents PK_PaymentProviderEvents; Type: CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentProviderEvents"
    ADD CONSTRAINT "PK_PaymentProviderEvents" PRIMARY KEY ("Id");


--
-- Name: PaymentRefunds PK_PaymentRefunds; Type: CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentRefunds"
    ADD CONSTRAINT "PK_PaymentRefunds" PRIMARY KEY ("Id");


--
-- Name: Payments PK_Payments; Type: CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."Payments"
    ADD CONSTRAINT "PK_Payments" PRIMARY KEY ("Id");


--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."__EFMigrationsHistory"
    ADD CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId");


--
-- Name: FakeProviderPayouts PK_FakeProviderPayouts; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."FakeProviderPayouts"
    ADD CONSTRAINT "PK_FakeProviderPayouts" PRIMARY KEY ("Id");


--
-- Name: PayoutAttempts PK_PayoutAttempts; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutAttempts"
    ADD CONSTRAINT "PK_PayoutAttempts" PRIMARY KEY ("Id");


--
-- Name: PayoutBeneficiaries PK_PayoutBeneficiaries; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutBeneficiaries"
    ADD CONSTRAINT "PK_PayoutBeneficiaries" PRIMARY KEY ("Id");


--
-- Name: PayoutObligations PK_PayoutObligations; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "PK_PayoutObligations" PRIMARY KEY ("Id");


--
-- Name: PayoutProviderEvents PK_PayoutProviderEvents; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutProviderEvents"
    ADD CONSTRAINT "PK_PayoutProviderEvents" PRIMARY KEY ("Id");


--
-- Name: PayoutReconciliationHistory PK_PayoutReconciliationHistory; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutReconciliationHistory"
    ADD CONSTRAINT "PK_PayoutReconciliationHistory" PRIMARY KEY ("Id");


--
-- Name: __EFMigrationsHistory PK___EFMigrationsHistory; Type: CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."__EFMigrationsHistory"
    ADD CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId");


--
-- Name: IX_audit_logs_EntityType_EntityId; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX "IX_audit_logs_EntityType_EntityId" ON audit.audit_logs USING btree ("EntityType", "EntityId");


--
-- Name: IX_audit_logs_Timestamp; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX "IX_audit_logs_Timestamp" ON audit.audit_logs USING btree ("Timestamp");


--
-- Name: IX_AuctionBenefitAllocations_AuctionResultId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionBenefitAllocations_AuctionResultId" ON groups."AuctionBenefitAllocations" USING btree ("AuctionResultId") WHERE ("AllocationType" = 'PlatformFee'::text);


--
-- Name: IX_AuctionBenefitAllocations_AuctionResultId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionBenefitAllocations_AuctionResultId_GroupId" ON groups."AuctionBenefitAllocations" USING btree ("AuctionResultId", "GroupId");


--
-- Name: IX_AuctionBenefitAllocations_AuctionResultId_MembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionBenefitAllocations_AuctionResultId_MembershipId" ON groups."AuctionBenefitAllocations" USING btree ("AuctionResultId", "MembershipId") WHERE ("MembershipId" IS NOT NULL);


--
-- Name: IX_AuctionBenefitAllocations_MembershipId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionBenefitAllocations_MembershipId_GroupId" ON groups."AuctionBenefitAllocations" USING btree ("MembershipId", "GroupId");


--
-- Name: IX_AuctionBids_AuctionId_GroupId_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionBids_AuctionId_GroupId_CycleId" ON groups."AuctionBids" USING btree ("AuctionId", "GroupId", "CycleId");


--
-- Name: IX_AuctionBids_AuctionId_MembershipId_IdempotencyKey; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionBids_AuctionId_MembershipId_IdempotencyKey" ON groups."AuctionBids" USING btree ("AuctionId", "MembershipId", "IdempotencyKey");


--
-- Name: IX_AuctionBids_AuctionId_SequenceNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionBids_AuctionId_SequenceNumber" ON groups."AuctionBids" USING btree ("AuctionId", "SequenceNumber");


--
-- Name: IX_AuctionBids_MembershipId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionBids_MembershipId_GroupId" ON groups."AuctionBids" USING btree ("MembershipId", "GroupId");


--
-- Name: IX_AuctionResults_AuctionId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionResults_AuctionId" ON groups."AuctionResults" USING btree ("AuctionId");


--
-- Name: IX_AuctionResults_AuctionId_GroupId_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionResults_AuctionId_GroupId_CycleId" ON groups."AuctionResults" USING btree ("AuctionId", "GroupId", "CycleId");


--
-- Name: IX_AuctionResults_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionResults_CycleId" ON groups."AuctionResults" USING btree ("CycleId");


--
-- Name: IX_AuctionResults_SelectionResultId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionResults_SelectionResultId" ON groups."AuctionResults" USING btree ("SelectionResultId");


--
-- Name: IX_AuctionResults_SelectionResultId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionResults_SelectionResultId_GroupId" ON groups."AuctionResults" USING btree ("SelectionResultId", "GroupId");


--
-- Name: IX_AuctionResults_WinningBidId_AuctionId_WinnerMembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionResults_WinningBidId_AuctionId_WinnerMembershipId" ON groups."AuctionResults" USING btree ("WinningBidId", "AuctionId", "WinnerMembershipId");


--
-- Name: IX_AuctionScheduleChanges_AuctionId_ChangeSequence; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_AuctionScheduleChanges_AuctionId_ChangeSequence" ON groups."AuctionScheduleChanges" USING btree ("AuctionId", "ChangeSequence");


--
-- Name: IX_AuctionScheduleChanges_AuctionId_GroupId_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionScheduleChanges_AuctionId_GroupId_CycleId" ON groups."AuctionScheduleChanges" USING btree ("AuctionId", "GroupId", "CycleId");


--
-- Name: IX_AuctionScheduleChanges_GroupId_CycleId_ChangedAt; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_AuctionScheduleChanges_GroupId_CycleId_ChangedAt" ON groups."AuctionScheduleChanges" USING btree ("GroupId", "CycleId", "ChangedAt");


--
-- Name: IX_Auctions_CurrentWinningBidId_Id_CurrentWinningMembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Auctions_CurrentWinningBidId_Id_CurrentWinningMembershipId" ON groups."Auctions" USING btree ("CurrentWinningBidId", "Id", "CurrentWinningMembershipId");


--
-- Name: IX_Auctions_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_Auctions_CycleId" ON groups."Auctions" USING btree ("CycleId");


--
-- Name: IX_Auctions_CycleId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Auctions_CycleId_GroupId" ON groups."Auctions" USING btree ("CycleId", "GroupId");


--
-- Name: IX_ContributionEntries_ContributionId_IdempotencyKey; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_ContributionEntries_ContributionId_IdempotencyKey" ON groups."ContributionEntries" USING btree ("ContributionId", "IdempotencyKey");


--
-- Name: IX_ContributionEntries_ContributionId_Reference; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_ContributionEntries_ContributionId_Reference" ON groups."ContributionEntries" USING btree ("ContributionId", "Reference") WHERE ("EntryType" = 'Record'::text);


--
-- Name: IX_ContributionEntries_Reference; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_ContributionEntries_Reference" ON groups."ContributionEntries" USING btree ("Reference");


--
-- Name: IX_ContributionEntries_ReversesEntryId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_ContributionEntries_ReversesEntryId" ON groups."ContributionEntries" USING btree ("ReversesEntryId") WHERE ("ReversesEntryId" IS NOT NULL);


--
-- Name: IX_ContributionEntries_ReversesEntryId_ContributionId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_ContributionEntries_ReversesEntryId_ContributionId" ON groups."ContributionEntries" USING btree ("ReversesEntryId", "ContributionId");


--
-- Name: IX_Contributions_CycleId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Contributions_CycleId_GroupId" ON groups."Contributions" USING btree ("CycleId", "GroupId");


--
-- Name: IX_Contributions_CycleId_MembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_Contributions_CycleId_MembershipId" ON groups."Contributions" USING btree ("CycleId", "MembershipId");


--
-- Name: IX_Contributions_DueDate; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Contributions_DueDate" ON groups."Contributions" USING btree ("DueDate");


--
-- Name: IX_Contributions_MembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Contributions_MembershipId" ON groups."Contributions" USING btree ("MembershipId");


--
-- Name: IX_Contributions_MembershipId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Contributions_MembershipId_GroupId" ON groups."Contributions" USING btree ("MembershipId", "GroupId");


--
-- Name: IX_Contributions_SettledPaymentId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_Contributions_SettledPaymentId" ON groups."Contributions" USING btree ("SettledPaymentId");


--
-- Name: IX_Contributions_Status_DueDate; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Contributions_Status_DueDate" ON groups."Contributions" USING btree ("Status", "DueDate");


--
-- Name: IX_GroupAuditEvents_GroupId_CreatedAt; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_GroupAuditEvents_GroupId_CreatedAt" ON groups."GroupAuditEvents" USING btree ("GroupId", "CreatedAt");


--
-- Name: IX_GroupMemberships_GroupId_SlotNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_GroupMemberships_GroupId_SlotNumber" ON groups."GroupMemberships" USING btree ("GroupId", "SlotNumber") WHERE ("SlotNumber" IS NOT NULL);


--
-- Name: IX_GroupMemberships_GroupId_UserId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_GroupMemberships_GroupId_UserId" ON groups."GroupMemberships" USING btree ("GroupId", "UserId");


--
-- Name: IX_GroupMemberships_Status; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_GroupMemberships_Status" ON groups."GroupMemberships" USING btree ("Status");


--
-- Name: IX_GroupMemberships_TermsVersionId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_GroupMemberships_TermsVersionId" ON groups."GroupMemberships" USING btree ("TermsVersionId");


--
-- Name: IX_GroupMemberships_UserId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_GroupMemberships_UserId" ON groups."GroupMemberships" USING btree ("UserId");


--
-- Name: IX_GroupRuleVersions_GroupId_VersionNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_GroupRuleVersions_GroupId_VersionNumber" ON groups."GroupRuleVersions" USING btree ("GroupId", "VersionNumber");


--
-- Name: IX_GroupTermsAcceptances_GroupRuleVersionId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_GroupTermsAcceptances_GroupRuleVersionId" ON groups."GroupTermsAcceptances" USING btree ("GroupRuleVersionId");


--
-- Name: IX_GroupTermsAcceptances_MembershipId_GroupRuleVersionId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_GroupTermsAcceptances_MembershipId_GroupRuleVersionId" ON groups."GroupTermsAcceptances" USING btree ("MembershipId", "GroupRuleVersionId");


--
-- Name: IX_Groups_CreatedByUserId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Groups_CreatedByUserId" ON groups."Groups" USING btree ("CreatedByUserId");


--
-- Name: IX_Groups_CreatorType; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Groups_CreatorType" ON groups."Groups" USING btree ("CreatorType");


--
-- Name: IX_Groups_GroupType; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Groups_GroupType" ON groups."Groups" USING btree ("GroupType");


--
-- Name: IX_Groups_GroupValue; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Groups_GroupValue" ON groups."Groups" USING btree ("GroupValue");


--
-- Name: IX_Groups_Status; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_Groups_Status" ON groups."Groups" USING btree ("Status");


--
-- Name: IX_IdempotencyRecords_Scope_Key; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_IdempotencyRecords_Scope_Key" ON groups."IdempotencyRecords" USING btree ("Scope", "Key");


--
-- Name: IX_MonthlyCycles_ContributionDueDate; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_MonthlyCycles_ContributionDueDate" ON groups."MonthlyCycles" USING btree ("ContributionDueDate");


--
-- Name: IX_MonthlyCycles_GroupId_CycleNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_MonthlyCycles_GroupId_CycleNumber" ON groups."MonthlyCycles" USING btree ("GroupId", "CycleNumber");


--
-- Name: IX_MonthlyCycles_OneOpenCycle; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_MonthlyCycles_OneOpenCycle" ON groups."MonthlyCycles" USING btree ("GroupId") WHERE ("Status" = ANY (ARRAY['CollectingContributions'::text, 'ContributionsComplete'::text, 'ReadyForSelection'::text]));


--
-- Name: IX_MonthlyCycles_SelectionResultId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_MonthlyCycles_SelectionResultId" ON groups."MonthlyCycles" USING btree ("SelectionResultId");


--
-- Name: IX_MonthlyCycles_Status; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_MonthlyCycles_Status" ON groups."MonthlyCycles" USING btree ("Status");


--
-- Name: IX_OneCollectingCycle; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_OneCollectingCycle" ON groups."MonthlyCycles" USING btree ("GroupId") WHERE ("Status" = 'CollectingContributions'::text);


--
-- Name: IX_SelectionEligibleMembers_MembershipId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_SelectionEligibleMembers_MembershipId_GroupId" ON groups."SelectionEligibleMembers" USING btree ("MembershipId", "GroupId");


--
-- Name: IX_SelectionEligibleMembers_SelectionResultId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_SelectionEligibleMembers_SelectionResultId_GroupId" ON groups."SelectionEligibleMembers" USING btree ("SelectionResultId", "GroupId");


--
-- Name: IX_SelectionEligibleMembers_SelectionResultId_Ordinal; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_SelectionEligibleMembers_SelectionResultId_Ordinal" ON groups."SelectionEligibleMembers" USING btree ("SelectionResultId", "Ordinal");


--
-- Name: IX_SelectionEligibleMembers_SelectionResultId_SlotNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_SelectionEligibleMembers_SelectionResultId_SlotNumber" ON groups."SelectionEligibleMembers" USING btree ("SelectionResultId", "SlotNumber");


--
-- Name: IX_SelectionResults_CycleId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_SelectionResults_CycleId" ON groups."SelectionResults" USING btree ("CycleId");


--
-- Name: IX_SelectionResults_CycleId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_SelectionResults_CycleId_GroupId" ON groups."SelectionResults" USING btree ("CycleId", "GroupId");


--
-- Name: IX_SelectionResults_GroupId_CycleNumber; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_SelectionResults_GroupId_CycleNumber" ON groups."SelectionResults" USING btree ("GroupId", "CycleNumber");


--
-- Name: IX_SelectionResults_GroupId_WinnerMembershipId; Type: INDEX; Schema: groups; Owner: -
--

CREATE UNIQUE INDEX "IX_SelectionResults_GroupId_WinnerMembershipId" ON groups."SelectionResults" USING btree ("GroupId", "WinnerMembershipId");


--
-- Name: IX_SelectionResults_WinnerMembershipId_WinnerUserId_GroupId; Type: INDEX; Schema: groups; Owner: -
--

CREATE INDEX "IX_SelectionResults_WinnerMembershipId_WinnerUserId_GroupId" ON groups."SelectionResults" USING btree ("WinnerMembershipId", "WinnerUserId", "GroupId");


--
-- Name: IX_email_verification_tokens_TokenHash; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX "IX_email_verification_tokens_TokenHash" ON identity.email_verification_tokens USING btree ("TokenHash");


--
-- Name: IX_email_verification_tokens_UserId; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX "IX_email_verification_tokens_UserId" ON identity.email_verification_tokens USING btree ("UserId");


--
-- Name: IX_password_reset_tokens_TokenHash; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX "IX_password_reset_tokens_TokenHash" ON identity.password_reset_tokens USING btree ("TokenHash");


--
-- Name: IX_password_reset_tokens_UserId; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX "IX_password_reset_tokens_UserId" ON identity.password_reset_tokens USING btree ("UserId");


--
-- Name: IX_refresh_tokens_TokenHash; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX "IX_refresh_tokens_TokenHash" ON identity.refresh_tokens USING btree ("TokenHash");


--
-- Name: IX_refresh_tokens_UserId; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX "IX_refresh_tokens_UserId" ON identity.refresh_tokens USING btree ("UserId");


--
-- Name: IX_roles_Name; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX "IX_roles_Name" ON identity.roles USING btree ("Name");


--
-- Name: IX_user_roles_RoleId; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX "IX_user_roles_RoleId" ON identity.user_roles USING btree ("RoleId");


--
-- Name: IX_users_NormalizedEmail; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX "IX_users_NormalizedEmail" ON identity.users USING btree ("NormalizedEmail");


--
-- Name: IX_JournalEntries_BusinessDate; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalEntries_BusinessDate" ON ledger."JournalEntries" USING btree ("BusinessDate");


--
-- Name: IX_JournalEntries_EventId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalEntries_EventId" ON ledger."JournalEntries" USING btree ("EventId");


--
-- Name: IX_JournalEntries_EventType_EventId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE UNIQUE INDEX "IX_JournalEntries_EventType_EventId" ON ledger."JournalEntries" USING btree ("EventType", "EventId");


--
-- Name: IX_JournalEntries_IdempotencyKey; Type: INDEX; Schema: ledger; Owner: -
--

CREATE UNIQUE INDEX "IX_JournalEntries_IdempotencyKey" ON ledger."JournalEntries" USING btree ("IdempotencyKey");


--
-- Name: IX_JournalEntries_JournalNumber; Type: INDEX; Schema: ledger; Owner: -
--

CREATE UNIQUE INDEX "IX_JournalEntries_JournalNumber" ON ledger."JournalEntries" USING btree ("JournalNumber");


--
-- Name: IX_JournalEntries_PostedAt; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalEntries_PostedAt" ON ledger."JournalEntries" USING btree ("PostedAt");


--
-- Name: IX_JournalEntries_ReversesJournalEntryId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE UNIQUE INDEX "IX_JournalEntries_ReversesJournalEntryId" ON ledger."JournalEntries" USING btree ("ReversesJournalEntryId") WHERE ("ReversesJournalEntryId" IS NOT NULL);


--
-- Name: IX_JournalLines_AccountId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_AccountId" ON ledger."JournalLines" USING btree ("AccountId");


--
-- Name: IX_JournalLines_AuctionResultId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_AuctionResultId" ON ledger."JournalLines" USING btree ("AuctionResultId");


--
-- Name: IX_JournalLines_ContributionId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_ContributionId" ON ledger."JournalLines" USING btree ("ContributionId");


--
-- Name: IX_JournalLines_CycleId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_CycleId" ON ledger."JournalLines" USING btree ("CycleId");


--
-- Name: IX_JournalLines_GroupId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_GroupId" ON ledger."JournalLines" USING btree ("GroupId");


--
-- Name: IX_JournalLines_JournalEntryId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_JournalEntryId" ON ledger."JournalLines" USING btree ("JournalEntryId");


--
-- Name: IX_JournalLines_MembershipId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_MembershipId" ON ledger."JournalLines" USING btree ("MembershipId");


--
-- Name: IX_JournalLines_PaymentId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_PaymentId" ON ledger."JournalLines" USING btree ("PaymentId");


--
-- Name: IX_JournalLines_SelectionResultId; Type: INDEX; Schema: ledger; Owner: -
--

CREATE INDEX "IX_JournalLines_SelectionResultId" ON ledger."JournalLines" USING btree ("SelectionResultId");


--
-- Name: IX_LedgerAccounts_Code; Type: INDEX; Schema: ledger; Owner: -
--

CREATE UNIQUE INDEX "IX_LedgerAccounts_Code" ON ledger."LedgerAccounts" USING btree ("Code");


--
-- Name: IX_organizer_applications_Status; Type: INDEX; Schema: organizers; Owner: -
--

CREATE INDEX "IX_organizer_applications_Status" ON organizers.organizer_applications USING btree ("Status");


--
-- Name: IX_organizer_applications_UserId; Type: INDEX; Schema: organizers; Owner: -
--

CREATE INDEX "IX_organizer_applications_UserId" ON organizers.organizer_applications USING btree ("UserId");


--
-- Name: IX_organizer_applications_UserId_Status; Type: INDEX; Schema: organizers; Owner: -
--

CREATE INDEX "IX_organizer_applications_UserId_Status" ON organizers.organizer_applications USING btree ("UserId", "Status");


--
-- Name: IX_organizer_profiles_UserId; Type: INDEX; Schema: organizers; Owner: -
--

CREATE UNIQUE INDEX "IX_organizer_profiles_UserId" ON organizers.organizer_profiles USING btree ("UserId");


--
-- Name: IX_PaymentHistory_PaymentId_CreatedAt; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_PaymentHistory_PaymentId_CreatedAt" ON payments."PaymentHistory" USING btree ("PaymentId", "CreatedAt");


--
-- Name: IX_PaymentProviderEvents_PaymentId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_PaymentProviderEvents_PaymentId" ON payments."PaymentProviderEvents" USING btree ("PaymentId");


--
-- Name: IX_PaymentProviderEvents_Provider_EventKey; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_PaymentProviderEvents_Provider_EventKey" ON payments."PaymentProviderEvents" USING btree ("Provider", "EventKey");


--
-- Name: IX_PaymentRefunds_PaymentId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_PaymentRefunds_PaymentId" ON payments."PaymentRefunds" USING btree ("PaymentId");


--
-- Name: IX_PaymentRefunds_ProviderRefundId_Status; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_PaymentRefunds_ProviderRefundId_Status" ON payments."PaymentRefunds" USING btree ("ProviderRefundId", "Status");


--
-- Name: IX_Payments_ContributionId; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_ContributionId" ON payments."Payments" USING btree ("ContributionId") WHERE ("RefundedAt" IS NULL);


--
-- Name: IX_Payments_ContributionId_AttemptNumber; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_ContributionId_AttemptNumber" ON payments."Payments" USING btree ("ContributionId", "AttemptNumber");


--
-- Name: IX_Payments_ContributionId_IdempotencyKey; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_ContributionId_IdempotencyKey" ON payments."Payments" USING btree ("ContributionId", "IdempotencyKey");


--
-- Name: IX_Payments_CycleId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_CycleId" ON payments."Payments" USING btree ("CycleId");


--
-- Name: IX_Payments_GroupId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_GroupId" ON payments."Payments" USING btree ("GroupId");


--
-- Name: IX_Payments_MembershipId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_MembershipId" ON payments."Payments" USING btree ("MembershipId");


--
-- Name: IX_Payments_ProviderOrderId; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_ProviderOrderId" ON payments."Payments" USING btree ("ProviderOrderId");


--
-- Name: IX_Payments_ProviderPaymentId; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_ProviderPaymentId" ON payments."Payments" USING btree ("ProviderPaymentId");


--
-- Name: IX_Payments_Receipt; Type: INDEX; Schema: payments; Owner: -
--

CREATE UNIQUE INDEX "IX_Payments_Receipt" ON payments."Payments" USING btree ("Receipt");


--
-- Name: IX_Payments_ReconciliationStatus; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_ReconciliationStatus" ON payments."Payments" USING btree ("ReconciliationStatus");


--
-- Name: IX_Payments_Status; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_Status" ON payments."Payments" USING btree ("Status");


--
-- Name: IX_Payments_UserId; Type: INDEX; Schema: payments; Owner: -
--

CREATE INDEX "IX_Payments_UserId" ON payments."Payments" USING btree ("UserId");


--
-- Name: IX_FakeProviderPayouts_IdempotencyKey; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_FakeProviderPayouts_IdempotencyKey" ON payouts."FakeProviderPayouts" USING btree ("IdempotencyKey");


--
-- Name: IX_PayoutAttempts_BeneficiaryId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutAttempts_BeneficiaryId" ON payouts."PayoutAttempts" USING btree ("BeneficiaryId");


--
-- Name: IX_PayoutAttempts_IdempotencyKey; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutAttempts_IdempotencyKey" ON payouts."PayoutAttempts" USING btree ("IdempotencyKey");


--
-- Name: IX_PayoutAttempts_PayoutObligationId_AttemptNumber; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutAttempts_PayoutObligationId_AttemptNumber" ON payouts."PayoutAttempts" USING btree ("PayoutObligationId", "AttemptNumber");


--
-- Name: IX_PayoutAttempts_PayoutObligationId_RequestKey; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutAttempts_PayoutObligationId_RequestKey" ON payouts."PayoutAttempts" USING btree ("PayoutObligationId", "RequestKey");


--
-- Name: IX_PayoutAttempts_ProviderPayoutId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutAttempts_ProviderPayoutId" ON payouts."PayoutAttempts" USING btree ("ProviderPayoutId");


--
-- Name: IX_PayoutBeneficiaries_ProviderFundAccountId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutBeneficiaries_ProviderFundAccountId" ON payouts."PayoutBeneficiaries" USING btree ("ProviderFundAccountId");


--
-- Name: IX_PayoutBeneficiaries_UserId_CreatedAt; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutBeneficiaries_UserId_CreatedAt" ON payouts."PayoutBeneficiaries" USING btree ("UserId", "CreatedAt");


--
-- Name: IX_PayoutObligations_BeneficiaryId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutObligations_BeneficiaryId" ON payouts."PayoutObligations" USING btree ("BeneficiaryId");


--
-- Name: IX_PayoutObligations_CycleId_MembershipId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutObligations_CycleId_MembershipId" ON payouts."PayoutObligations" USING btree ("CycleId", "MembershipId") WHERE ("PayoutType" = 'MemberAuctionBenefit'::text);


--
-- Name: IX_PayoutObligations_CycleId_PayoutType; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutObligations_CycleId_PayoutType" ON payouts."PayoutObligations" USING btree ("CycleId", "PayoutType") WHERE ("PayoutType" = ANY (ARRAY['WinnerPayout'::text, 'PlatformFeeSettlement'::text]));


--
-- Name: IX_PayoutObligations_CycleId_PayoutType_SourceId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutObligations_CycleId_PayoutType_SourceId" ON payouts."PayoutObligations" USING btree ("CycleId", "PayoutType", "SourceId");


--
-- Name: IX_PayoutObligations_GroupId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutObligations_GroupId" ON payouts."PayoutObligations" USING btree ("GroupId");


--
-- Name: IX_PayoutObligations_Status; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutObligations_Status" ON payouts."PayoutObligations" USING btree ("Status");


--
-- Name: IX_PayoutObligations_UserId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutObligations_UserId" ON payouts."PayoutObligations" USING btree ("UserId");


--
-- Name: IX_PayoutProviderEvents_PayoutAttemptId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutProviderEvents_PayoutAttemptId" ON payouts."PayoutProviderEvents" USING btree ("PayoutAttemptId");


--
-- Name: IX_PayoutProviderEvents_PayoutObligationId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutProviderEvents_PayoutObligationId" ON payouts."PayoutProviderEvents" USING btree ("PayoutObligationId");


--
-- Name: IX_PayoutProviderEvents_Provider_ProviderEventId; Type: INDEX; Schema: payouts; Owner: -
--

CREATE UNIQUE INDEX "IX_PayoutProviderEvents_Provider_ProviderEventId" ON payouts."PayoutProviderEvents" USING btree ("Provider", "ProviderEventId");


--
-- Name: IX_PayoutReconciliationHistory_PayoutObligationId_CreatedAt; Type: INDEX; Schema: payouts; Owner: -
--

CREATE INDEX "IX_PayoutReconciliationHistory_PayoutObligationId_CreatedAt" ON payouts."PayoutReconciliationHistory" USING btree ("PayoutObligationId", "CreatedAt");


--
-- Name: AuctionBenefitAllocations auction_allocation_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_allocation_immutable BEFORE DELETE OR UPDATE ON groups."AuctionBenefitAllocations" FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();


--
-- Name: AuctionBenefitAllocations auction_allocation_total; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER auction_allocation_total AFTER INSERT ON groups."AuctionBenefitAllocations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION groups.check_auction_allocation_total();


--
-- Name: AuctionBids auction_bid_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_bid_immutable BEFORE DELETE OR UPDATE ON groups."AuctionBids" FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();


--
-- Name: AuctionBids auction_bid_open; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_bid_open BEFORE INSERT ON groups."AuctionBids" FOR EACH ROW EXECUTE FUNCTION groups.guard_auction_bid_insert();


--
-- Name: AuctionResults auction_result_allocations; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER auction_result_allocations AFTER INSERT ON groups."AuctionResults" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION groups.check_auction_allocation_total();


--
-- Name: AuctionResults auction_result_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_result_immutable BEFORE DELETE OR UPDATE ON groups."AuctionResults" FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();


--
-- Name: AuctionScheduleChanges auction_schedule_changes_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_schedule_changes_immutable BEFORE DELETE OR UPDATE ON groups."AuctionScheduleChanges" FOR EACH ROW EXECUTE FUNCTION groups.reject_schedule_history_mutation();


--
-- Name: AuctionScheduleChanges auction_schedule_changes_no_truncate; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_schedule_changes_no_truncate BEFORE TRUNCATE ON groups."AuctionScheduleChanges" FOR EACH STATEMENT EXECUTE FUNCTION groups.reject_schedule_history_mutation();


--
-- Name: Auctions auction_terminal_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER auction_terminal_immutable BEFORE DELETE OR UPDATE ON groups."Auctions" FOR EACH ROW EXECUTE FUNCTION groups.guard_auction_terminal_state();


--
-- Name: Contributions contribution_cycle_finances; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER contribution_cycle_finances AFTER INSERT OR UPDATE ON groups."Contributions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_cycle_finances();


--
-- Name: ContributionEntries contribution_entries_append_only; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER contribution_entries_append_only BEFORE DELETE OR UPDATE ON groups."ContributionEntries" FOR EACH ROW EXECUTE FUNCTION groups.reject_operational_history_mutation();


--
-- Name: Contributions contribution_settlement_consistent; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER contribution_settlement_consistent AFTER INSERT OR UPDATE ON groups."Contributions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_contribution_settlement();


--
-- Name: MonthlyCycles cycle_finances_consistent; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER cycle_finances_consistent AFTER INSERT OR UPDATE ON groups."MonthlyCycles" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_cycle_finances();


--
-- Name: MonthlyCycles financial_cycle_protected; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER financial_cycle_protected BEFORE UPDATE ON groups."MonthlyCycles" FOR EACH ROW EXECUTE FUNCTION payments.protect_financial_cycle();


--
-- Name: IdempotencyRecords idempotency_records_append_only; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER idempotency_records_append_only BEFORE DELETE OR UPDATE ON groups."IdempotencyRecords" FOR EACH ROW EXECUTE FUNCTION groups.reject_operational_history_mutation();


--
-- Name: MonthlyCycles payout_completed_cycle_guard; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER payout_completed_cycle_guard BEFORE UPDATE ON groups."MonthlyCycles" FOR EACH ROW EXECUTE FUNCTION payouts.guard_completed_cycle();


--
-- Name: MonthlyCycles payout_cycle_consistency; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER payout_cycle_consistency AFTER UPDATE ON groups."MonthlyCycles" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_cycle_completion();


--
-- Name: Groups payout_group_consistency; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE CONSTRAINT TRIGGER payout_group_consistency AFTER UPDATE ON groups."Groups" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_group_completion();


--
-- Name: SelectionResults selection_result_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER selection_result_immutable BEFORE DELETE OR UPDATE ON groups."SelectionResults" FOR EACH ROW EXECUTE FUNCTION groups.reject_selection_history_mutation();


--
-- Name: SelectionEligibleMembers selection_snapshot_immutable; Type: TRIGGER; Schema: groups; Owner: -
--

CREATE TRIGGER selection_snapshot_immutable BEFORE DELETE OR UPDATE ON groups."SelectionEligibleMembers" FOR EACH ROW EXECUTE FUNCTION groups.reject_selection_history_mutation();


--
-- Name: JournalEntries journal_complete; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE CONSTRAINT TRIGGER journal_complete AFTER INSERT ON ledger."JournalEntries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.ensure_complete_journal();


--
-- Name: JournalEntries journal_immutable; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER journal_immutable BEFORE DELETE OR UPDATE ON ledger."JournalEntries" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();


--
-- Name: JournalLines journal_line_immutable; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER journal_line_immutable BEFORE DELETE OR UPDATE ON ledger."JournalLines" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();


--
-- Name: JournalLines journal_lines_complete; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE CONSTRAINT TRIGGER journal_lines_complete AFTER INSERT ON ledger."JournalLines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.ensure_complete_journal();


--
-- Name: LedgerAccounts system_account_immutable; Type: TRIGGER; Schema: ledger; Owner: -
--

CREATE TRIGGER system_account_immutable BEFORE DELETE OR UPDATE ON ledger."LedgerAccounts" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();


--
-- Name: PaymentProviderEvents events_immutable; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER events_immutable BEFORE DELETE OR UPDATE ON payments."PaymentProviderEvents" FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PaymentProviderEvents events_no_truncate; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON payments."PaymentProviderEvents" FOR EACH STATEMENT EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PaymentHistory history_immutable; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER history_immutable BEFORE DELETE OR UPDATE ON payments."PaymentHistory" FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PaymentHistory history_no_truncate; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON payments."PaymentHistory" FOR EACH STATEMENT EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: Payments payment_consistent; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE CONSTRAINT TRIGGER payment_consistent AFTER INSERT OR UPDATE ON payments."Payments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_payment_consistency();


--
-- Name: Payments payment_protected; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER payment_protected BEFORE UPDATE ON payments."Payments" FOR EACH ROW EXECUTE FUNCTION payments.protect_payment();


--
-- Name: Payments payments_no_delete; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments."Payments" FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: Payments payments_no_truncate; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments."Payments" FOR EACH STATEMENT EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PaymentRefunds refunds_immutable; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER refunds_immutable BEFORE DELETE OR UPDATE ON payments."PaymentRefunds" FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PaymentRefunds refunds_no_truncate; Type: TRIGGER; Schema: payments; Owner: -
--

CREATE TRIGGER refunds_no_truncate BEFORE TRUNCATE ON payments."PaymentRefunds" FOR EACH STATEMENT EXECUTE FUNCTION payments.reject_history_mutation();


--
-- Name: PayoutAttempts immutable_history; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON payouts."PayoutAttempts" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutBeneficiaries immutable_history; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON payouts."PayoutBeneficiaries" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutProviderEvents immutable_history; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON payouts."PayoutProviderEvents" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutReconciliationHistory immutable_history; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_history BEFORE DELETE OR UPDATE ON payouts."PayoutReconciliationHistory" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutAttempts immutable_truncate; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payouts."PayoutAttempts" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutBeneficiaries immutable_truncate; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payouts."PayoutBeneficiaries" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutProviderEvents immutable_truncate; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payouts."PayoutProviderEvents" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutReconciliationHistory immutable_truncate; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payouts."PayoutReconciliationHistory" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutObligations no_payout_delete; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER no_payout_delete BEFORE DELETE ON payouts."PayoutObligations" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutObligations no_payout_truncate; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER no_payout_truncate BEFORE TRUNCATE ON payouts."PayoutObligations" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();


--
-- Name: PayoutAttempts payout_attempt_guard; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER payout_attempt_guard BEFORE INSERT ON payouts."PayoutAttempts" FOR EACH ROW EXECUTE FUNCTION payouts.guard_attempt();


--
-- Name: PayoutProviderEvents payout_event_source_guard; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER payout_event_source_guard BEFORE INSERT ON payouts."PayoutProviderEvents" FOR EACH ROW EXECUTE FUNCTION payouts.guard_provider_event();


--
-- Name: PayoutObligations payout_settlement_consistency; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE CONSTRAINT TRIGGER payout_settlement_consistency AFTER INSERT OR UPDATE ON payouts."PayoutObligations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_settlement();


--
-- Name: PayoutObligations payout_source_guard; Type: TRIGGER; Schema: payouts; Owner: -
--

CREATE TRIGGER payout_source_guard BEFORE INSERT OR UPDATE ON payouts."PayoutObligations" FOR EACH ROW EXECUTE FUNCTION payouts.guard_obligation();


--
-- Name: AuctionBenefitAllocations FK_AuctionBenefitAllocations_AuctionResults_AuctionResultId_Gr~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBenefitAllocations"
    ADD CONSTRAINT "FK_AuctionBenefitAllocations_AuctionResults_AuctionResultId_Gr~" FOREIGN KEY ("AuctionResultId", "GroupId") REFERENCES groups."AuctionResults"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: AuctionBenefitAllocations FK_AuctionBenefitAllocations_GroupMemberships_MembershipId_Gro~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBenefitAllocations"
    ADD CONSTRAINT "FK_AuctionBenefitAllocations_GroupMemberships_MembershipId_Gro~" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: AuctionBids FK_AuctionBids_Auctions_AuctionId_GroupId_CycleId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBids"
    ADD CONSTRAINT "FK_AuctionBids_Auctions_AuctionId_GroupId_CycleId" FOREIGN KEY ("AuctionId", "GroupId", "CycleId") REFERENCES groups."Auctions"("Id", "GroupId", "CycleId") ON DELETE RESTRICT;


--
-- Name: AuctionBids FK_AuctionBids_GroupMemberships_MembershipId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionBids"
    ADD CONSTRAINT "FK_AuctionBids_GroupMemberships_MembershipId_GroupId" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: AuctionResults FK_AuctionResult_Actor; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "FK_AuctionResult_Actor" FOREIGN KEY ("FinalizedByUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: AuctionResults FK_AuctionResults_AuctionBids_WinningBidId_AuctionId_WinnerMem~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "FK_AuctionResults_AuctionBids_WinningBidId_AuctionId_WinnerMem~" FOREIGN KEY ("WinningBidId", "AuctionId", "WinnerMembershipId") REFERENCES groups."AuctionBids"("Id", "AuctionId", "MembershipId") ON DELETE RESTRICT;


--
-- Name: AuctionResults FK_AuctionResults_Auctions_AuctionId_GroupId_CycleId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "FK_AuctionResults_Auctions_AuctionId_GroupId_CycleId" FOREIGN KEY ("AuctionId", "GroupId", "CycleId") REFERENCES groups."Auctions"("Id", "GroupId", "CycleId") ON DELETE RESTRICT;


--
-- Name: AuctionResults FK_AuctionResults_SelectionResults_SelectionResultId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionResults"
    ADD CONSTRAINT "FK_AuctionResults_SelectionResults_SelectionResultId_GroupId" FOREIGN KEY ("SelectionResultId", "GroupId") REFERENCES groups."SelectionResults"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: AuctionScheduleChanges FK_AuctionScheduleChanges_Auctions_AuctionId_GroupId_CycleId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."AuctionScheduleChanges"
    ADD CONSTRAINT "FK_AuctionScheduleChanges_Auctions_AuctionId_GroupId_CycleId" FOREIGN KEY ("AuctionId", "GroupId", "CycleId") REFERENCES groups."Auctions"("Id", "GroupId", "CycleId") ON DELETE RESTRICT;


--
-- Name: Auctions FK_Auctions_AuctionBids_CurrentWinningBidId_Id_CurrentWinningM~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Auctions"
    ADD CONSTRAINT "FK_Auctions_AuctionBids_CurrentWinningBidId_Id_CurrentWinningM~" FOREIGN KEY ("CurrentWinningBidId", "Id", "CurrentWinningMembershipId") REFERENCES groups."AuctionBids"("Id", "AuctionId", "MembershipId") ON DELETE RESTRICT;


--
-- Name: Auctions FK_Auctions_MonthlyCycles_CycleId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Auctions"
    ADD CONSTRAINT "FK_Auctions_MonthlyCycles_CycleId_GroupId" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: ContributionEntries FK_ContributionEntries_ContributionEntries_ReversesEntryId_Con~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."ContributionEntries"
    ADD CONSTRAINT "FK_ContributionEntries_ContributionEntries_ReversesEntryId_Con~" FOREIGN KEY ("ReversesEntryId", "ContributionId") REFERENCES groups."ContributionEntries"("Id", "ContributionId") ON DELETE RESTRICT;


--
-- Name: ContributionEntries FK_ContributionEntries_Contributions_ContributionId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."ContributionEntries"
    ADD CONSTRAINT "FK_ContributionEntries_Contributions_ContributionId" FOREIGN KEY ("ContributionId") REFERENCES groups."Contributions"("Id") ON DELETE RESTRICT;


--
-- Name: ContributionEntries FK_ContributionEntry_Actor; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."ContributionEntries"
    ADD CONSTRAINT "FK_ContributionEntry_Actor" FOREIGN KEY ("RecordedByUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: Contributions FK_Contribution_SettledPayment; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Contributions"
    ADD CONSTRAINT "FK_Contribution_SettledPayment" FOREIGN KEY ("SettledPaymentId") REFERENCES payments."Payments"("Id") ON DELETE RESTRICT;


--
-- Name: Contributions FK_Contributions_GroupMemberships_MembershipId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Contributions"
    ADD CONSTRAINT "FK_Contributions_GroupMemberships_MembershipId_GroupId" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: Contributions FK_Contributions_MonthlyCycles_CycleId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Contributions"
    ADD CONSTRAINT "FK_Contributions_MonthlyCycles_CycleId_GroupId" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: GroupAuditEvents FK_GroupAuditEvents_Groups_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupAuditEvents"
    ADD CONSTRAINT "FK_GroupAuditEvents_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES groups."Groups"("Id") ON DELETE RESTRICT;


--
-- Name: GroupAuditEvents FK_GroupAudit_Actor; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupAuditEvents"
    ADD CONSTRAINT "FK_GroupAudit_Actor" FOREIGN KEY ("ActorUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: GroupMemberships FK_GroupMemberships_GroupRuleVersions_TermsVersionId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "FK_GroupMemberships_GroupRuleVersions_TermsVersionId" FOREIGN KEY ("TermsVersionId") REFERENCES groups."GroupRuleVersions"("Id") ON DELETE RESTRICT;


--
-- Name: GroupMemberships FK_GroupMemberships_Groups_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "FK_GroupMemberships_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES groups."Groups"("Id") ON DELETE RESTRICT;


--
-- Name: GroupRuleVersions FK_GroupRuleVersions_Groups_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupRuleVersions"
    ADD CONSTRAINT "FK_GroupRuleVersions_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES groups."Groups"("Id") ON DELETE RESTRICT;


--
-- Name: GroupTermsAcceptances FK_GroupTermsAcceptances_GroupMemberships_MembershipId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupTermsAcceptances"
    ADD CONSTRAINT "FK_GroupTermsAcceptances_GroupMemberships_MembershipId" FOREIGN KEY ("MembershipId") REFERENCES groups."GroupMemberships"("Id") ON DELETE RESTRICT;


--
-- Name: GroupTermsAcceptances FK_GroupTermsAcceptances_GroupRuleVersions_GroupRuleVersionId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupTermsAcceptances"
    ADD CONSTRAINT "FK_GroupTermsAcceptances_GroupRuleVersions_GroupRuleVersionId" FOREIGN KEY ("GroupRuleVersionId") REFERENCES groups."GroupRuleVersions"("Id") ON DELETE RESTRICT;


--
-- Name: Groups FK_Groups_Creator; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."Groups"
    ADD CONSTRAINT "FK_Groups_Creator" FOREIGN KEY ("CreatedByUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: GroupMemberships FK_Memberships_User; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupMemberships"
    ADD CONSTRAINT "FK_Memberships_User" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: MonthlyCycles FK_MonthlyCycles_Groups_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."MonthlyCycles"
    ADD CONSTRAINT "FK_MonthlyCycles_Groups_GroupId" FOREIGN KEY ("GroupId") REFERENCES groups."Groups"("Id") ON DELETE RESTRICT;


--
-- Name: MonthlyCycles FK_MonthlyCycles_SelectionResults_SelectionResultId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."MonthlyCycles"
    ADD CONSTRAINT "FK_MonthlyCycles_SelectionResults_SelectionResultId" FOREIGN KEY ("SelectionResultId") REFERENCES groups."SelectionResults"("Id") ON DELETE RESTRICT;


--
-- Name: GroupRuleVersions FK_Rules_Creator; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."GroupRuleVersions"
    ADD CONSTRAINT "FK_Rules_Creator" FOREIGN KEY ("CreatedByUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: SelectionEligibleMembers FK_SelectionEligibleMembers_GroupMemberships_MembershipId_Grou~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionEligibleMembers"
    ADD CONSTRAINT "FK_SelectionEligibleMembers_GroupMemberships_MembershipId_Grou~" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: SelectionEligibleMembers FK_SelectionEligibleMembers_SelectionResults_SelectionResultId~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionEligibleMembers"
    ADD CONSTRAINT "FK_SelectionEligibleMembers_SelectionResults_SelectionResultId~" FOREIGN KEY ("SelectionResultId", "GroupId") REFERENCES groups."SelectionResults"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: SelectionResults FK_SelectionResults_GroupMemberships_WinnerMembershipId_Winner~; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionResults"
    ADD CONSTRAINT "FK_SelectionResults_GroupMemberships_WinnerMembershipId_Winner~" FOREIGN KEY ("WinnerMembershipId", "WinnerUserId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "UserId", "GroupId") ON DELETE RESTRICT;


--
-- Name: SelectionResults FK_SelectionResults_MonthlyCycles_CycleId_GroupId; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionResults"
    ADD CONSTRAINT "FK_SelectionResults_MonthlyCycles_CycleId_GroupId" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: SelectionResults FK_Selection_Actor; Type: FK CONSTRAINT; Schema: groups; Owner: -
--

ALTER TABLE ONLY groups."SelectionResults"
    ADD CONSTRAINT "FK_Selection_Actor" FOREIGN KEY ("ExecutedByUserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: email_verification_tokens FK_email_verification_tokens_users_UserId; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.email_verification_tokens
    ADD CONSTRAINT "FK_email_verification_tokens_users_UserId" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE CASCADE;


--
-- Name: password_reset_tokens FK_password_reset_tokens_users_UserId; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.password_reset_tokens
    ADD CONSTRAINT "FK_password_reset_tokens_users_UserId" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE CASCADE;


--
-- Name: refresh_tokens FK_refresh_tokens_users_UserId; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT "FK_refresh_tokens_users_UserId" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE CASCADE;


--
-- Name: user_roles FK_user_roles_roles_RoleId; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_roles
    ADD CONSTRAINT "FK_user_roles_roles_RoleId" FOREIGN KEY ("RoleId") REFERENCES identity.roles("Id") ON DELETE RESTRICT;


--
-- Name: user_roles FK_user_roles_users_UserId; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_roles
    ADD CONSTRAINT "FK_user_roles_users_UserId" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE CASCADE;


--
-- Name: JournalEntries FK_JournalEntries_JournalEntries_ReversesJournalEntryId; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalEntries"
    ADD CONSTRAINT "FK_JournalEntries_JournalEntries_ReversesJournalEntryId" FOREIGN KEY ("ReversesJournalEntryId") REFERENCES ledger."JournalEntries"("Id") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_JournalLines_JournalEntries_JournalEntryId; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_JournalLines_JournalEntries_JournalEntryId" FOREIGN KEY ("JournalEntryId") REFERENCES ledger."JournalEntries"("Id") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_JournalLines_LedgerAccounts_AccountId; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_JournalLines_LedgerAccounts_AccountId" FOREIGN KEY ("AccountId") REFERENCES ledger."LedgerAccounts"("Id") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Ledger_Auction; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Ledger_Auction" FOREIGN KEY ("AuctionResultId", "GroupId") REFERENCES groups."AuctionResults"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Ledger_Cycle; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Ledger_Cycle" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Ledger_Group; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Ledger_Group" FOREIGN KEY ("GroupId") REFERENCES groups."Groups"("Id") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Ledger_Membership; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Ledger_Membership" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Ledger_Selection; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Ledger_Selection" FOREIGN KEY ("SelectionResultId", "GroupId") REFERENCES groups."SelectionResults"("Id", "GroupId") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Line_Contribution; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Line_Contribution" FOREIGN KEY ("ContributionId") REFERENCES groups."Contributions"("Id") ON DELETE RESTRICT;


--
-- Name: JournalLines FK_Line_Payment; Type: FK CONSTRAINT; Schema: ledger; Owner: -
--

ALTER TABLE ONLY ledger."JournalLines"
    ADD CONSTRAINT "FK_Line_Payment" FOREIGN KEY ("PaymentId") REFERENCES payments."Payments"("Id") ON DELETE RESTRICT;


--
-- Name: PaymentHistory FK_PaymentHistory_Payments_PaymentId; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentHistory"
    ADD CONSTRAINT "FK_PaymentHistory_Payments_PaymentId" FOREIGN KEY ("PaymentId") REFERENCES payments."Payments"("Id") ON DELETE RESTRICT;


--
-- Name: PaymentProviderEvents FK_PaymentProviderEvents_Payments_PaymentId; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentProviderEvents"
    ADD CONSTRAINT "FK_PaymentProviderEvents_Payments_PaymentId" FOREIGN KEY ("PaymentId") REFERENCES payments."Payments"("Id") ON DELETE RESTRICT;


--
-- Name: PaymentRefunds FK_PaymentRefunds_Payments_PaymentId; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."PaymentRefunds"
    ADD CONSTRAINT "FK_PaymentRefunds_Payments_PaymentId" FOREIGN KEY ("PaymentId") REFERENCES payments."Payments"("Id") ON DELETE RESTRICT;


--
-- Name: Payments FK_Payment_Contribution; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."Payments"
    ADD CONSTRAINT "FK_Payment_Contribution" FOREIGN KEY ("ContributionId") REFERENCES groups."Contributions"("Id") ON DELETE RESTRICT;


--
-- Name: Payments FK_Payment_Journal; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."Payments"
    ADD CONSTRAINT "FK_Payment_Journal" FOREIGN KEY ("JournalId") REFERENCES ledger."JournalEntries"("Id") ON DELETE RESTRICT;


--
-- Name: Payments FK_Payment_Reversal; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."Payments"
    ADD CONSTRAINT "FK_Payment_Reversal" FOREIGN KEY ("ReversalJournalId") REFERENCES ledger."JournalEntries"("Id") ON DELETE RESTRICT;


--
-- Name: Payments FK_Payment_User; Type: FK CONSTRAINT; Schema: payments; Owner: -
--

ALTER TABLE ONLY payments."Payments"
    ADD CONSTRAINT "FK_Payment_User" FOREIGN KEY ("UserId") REFERENCES identity.users("Id") ON DELETE RESTRICT;


--
-- Name: PayoutBeneficiaries FK_Beneficiary_User; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutBeneficiaries"
    ADD CONSTRAINT "FK_Beneficiary_User" FOREIGN KEY ("UserId") REFERENCES identity.users("Id");


--
-- Name: PayoutAttempts FK_PayoutAttempts_PayoutBeneficiaries_BeneficiaryId; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutAttempts"
    ADD CONSTRAINT "FK_PayoutAttempts_PayoutBeneficiaries_BeneficiaryId" FOREIGN KEY ("BeneficiaryId") REFERENCES payouts."PayoutBeneficiaries"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutAttempts FK_PayoutAttempts_PayoutObligations_PayoutObligationId; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutAttempts"
    ADD CONSTRAINT "FK_PayoutAttempts_PayoutObligations_PayoutObligationId" FOREIGN KEY ("PayoutObligationId") REFERENCES payouts."PayoutObligations"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutObligations FK_PayoutObligations_PayoutBeneficiaries_BeneficiaryId; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_PayoutObligations_PayoutBeneficiaries_BeneficiaryId" FOREIGN KEY ("BeneficiaryId") REFERENCES payouts."PayoutBeneficiaries"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutProviderEvents FK_PayoutProviderEvents_PayoutAttempts_PayoutAttemptId; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutProviderEvents"
    ADD CONSTRAINT "FK_PayoutProviderEvents_PayoutAttempts_PayoutAttemptId" FOREIGN KEY ("PayoutAttemptId") REFERENCES payouts."PayoutAttempts"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutProviderEvents FK_PayoutProviderEvents_PayoutObligations_PayoutObligationId; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutProviderEvents"
    ADD CONSTRAINT "FK_PayoutProviderEvents_PayoutObligations_PayoutObligationId" FOREIGN KEY ("PayoutObligationId") REFERENCES payouts."PayoutObligations"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutReconciliationHistory FK_PayoutReconciliationHistory_PayoutObligations_PayoutObligat~; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutReconciliationHistory"
    ADD CONSTRAINT "FK_PayoutReconciliationHistory_PayoutObligations_PayoutObligat~" FOREIGN KEY ("PayoutObligationId") REFERENCES payouts."PayoutObligations"("Id") ON DELETE RESTRICT;


--
-- Name: PayoutObligations FK_Payout_AllocationJournal; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_Payout_AllocationJournal" FOREIGN KEY ("AllocationJournalId") REFERENCES ledger."JournalEntries"("Id");


--
-- Name: PayoutObligations FK_Payout_Cycle; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_Payout_Cycle" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles"("Id", "GroupId");


--
-- Name: PayoutObligations FK_Payout_Member; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_Payout_Member" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships"("Id", "GroupId");


--
-- Name: PayoutObligations FK_Payout_Selection; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_Payout_Selection" FOREIGN KEY ("SelectionResultId") REFERENCES groups."SelectionResults"("Id");


--
-- Name: PayoutObligations FK_Payout_SettlementJournal; Type: FK CONSTRAINT; Schema: payouts; Owner: -
--

ALTER TABLE ONLY payouts."PayoutObligations"
    ADD CONSTRAINT "FK_Payout_SettlementJournal" FOREIGN KEY ("SettlementJournalId") REFERENCES ledger."JournalEntries"("Id");


--
-- PostgreSQL database dump complete
--



-- ----------------------------------------------------------------------------------------------
-- Reference data (roles, system ledger accounts) and EF migration history.
-- ----------------------------------------------------------------------------------------------
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: __ef_migrations_history; Type: TABLE DATA; Schema: audit; Owner: -
--

INSERT INTO audit.__ef_migrations_history VALUES
	('20260906055315_IdentityAuditLog', '10.0.11');


--
-- Data for Name: __EFMigrationsHistory; Type: TABLE DATA; Schema: groups; Owner: -
--

INSERT INTO groups."__EFMigrationsHistory" VALUES
	('20260909045323_GroupsAndMembershipFoundation', '10.0.11'),
	('20260909051922_MonthlyCyclesAndContributionTracking', '10.0.11'),
	('20260909100752_RandomAndReservedSelectionFoundation', '10.0.11'),
	('20260909154641_AuctionEngine', '10.0.11'),
	('20260913093859_RazorpayTestPayments', '10.0.11'),
	('20260914061232_PayoutCycleCompletion', '10.0.11'),
	('20260914110345_DevelopmentGroupMemberRange', '10.0.11'),
	('20260922105110_AuctionRescheduling', '10.0.11');


--
-- Data for Name: __ef_migrations_history; Type: TABLE DATA; Schema: identity; Owner: -
--

INSERT INTO identity.__ef_migrations_history VALUES
	('20260906055249_IdentityAndAuthentication', '10.0.11');


--
-- Data for Name: roles; Type: TABLE DATA; Schema: identity; Owner: -
--

INSERT INTO identity.roles VALUES
	('0418555c-a60b-4a81-b888-ac152e22171e', 'ADMIN'),
	('4b42d39c-32b8-46b3-8d33-8decc97d91f4', 'ORGANIZER'),
	('cf8d7460-9d9a-4874-a56f-fa7618002f03', 'SUPER_ADMIN'),
	('d2a12208-eecc-4235-b7ea-a6b1a62ea4ae', 'USER');


--
-- Data for Name: LedgerAccounts; Type: TABLE DATA; Schema: ledger; Owner: -
--

INSERT INTO ledger."LedgerAccounts" VALUES
	('0e8d40d9-3986-4342-911a-40ebe69272f3', '1000', 'Cash clearing (future settlement)', 'Asset', 'Debit', true, true, '2026-10-01 07:20:51.009451+00'),
	('932cf4a1-3784-4494-821d-8682245f5065', '1010', 'Razorpay test payment gateway clearing', 'Asset', 'Debit', true, true, '2026-10-01 07:20:51.02392+00'),
	('ede735c9-db19-46fd-85d0-8d4d2ceab504', '1020', 'Test payout gateway clearing', 'Asset', 'Debit', true, true, '2026-10-01 07:20:51.024353+00'),
	('5e9ce757-473b-4424-8596-2b868d72bb22', '1100', 'Member receivable', 'Asset', 'Debit', true, true, '2026-10-01 07:20:51.024695+00'),
	('64834f60-197d-43c7-9bdc-b4eda8535ad6', '1200', 'Platform fee receivable', 'Asset', 'Debit', true, true, '2026-10-01 07:20:51.025009+00'),
	('54f29df1-ec81-4300-9d92-c91f3f5ea1cc', '2000', 'Group pool liability', 'Liability', 'Credit', true, true, '2026-10-01 07:20:51.025317+00'),
	('7724afb7-c0f7-4b43-9c9f-9018d1b71dc7', '2100', 'Member payout liability', 'Liability', 'Credit', true, true, '2026-10-01 07:20:51.025632+00'),
	('190f6fbb-0c11-4011-962e-a07f799d9a6b', '2200', 'Member auction benefit liability', 'Liability', 'Credit', true, true, '2026-10-01 07:20:51.025937+00'),
	('0328b44f-b27e-4fe5-98a4-a042b010a7ed', '2300', 'Deferred platform fee liability', 'Liability', 'Credit', true, true, '2026-10-01 07:20:51.026225+00'),
	('47eb758c-d37f-405d-9f15-d0d050900d11', '4000', 'Platform service fee revenue', 'Revenue', 'Credit', true, true, '2026-10-01 07:20:51.026524+00');


--
-- Data for Name: __EFMigrationsHistory; Type: TABLE DATA; Schema: ledger; Owner: -
--

INSERT INTO ledger."__EFMigrationsHistory" VALUES
	('20260911153737_FinancialLedgerFoundation', '10.0.11'),
	('20260913093903_RazorpayTestPayments', '10.0.11');


--
-- Data for Name: __ef_migrations_history; Type: TABLE DATA; Schema: organizers; Owner: -
--

INSERT INTO organizers.__ef_migrations_history VALUES
	('20260906055310_OrganizerApplications', '10.0.11');


--
-- Data for Name: __EFMigrationsHistory; Type: TABLE DATA; Schema: payments; Owner: -
--

INSERT INTO payments."__EFMigrationsHistory" VALUES
	('20260913093907_RazorpayTestPayments', '10.0.11');


--
-- Data for Name: __EFMigrationsHistory; Type: TABLE DATA; Schema: payouts; Owner: -
--

INSERT INTO payouts."__EFMigrationsHistory" VALUES
	('20260914061429_OutgoingPayoutSettlement', '10.0.11');


--
-- PostgreSQL database dump complete
--


