namespace Dhanvi.Modules.Payouts.Infrastructure.Persistence;
internal static class PayoutDatabaseGuards
{
    public const string Sql = """
CREATE FUNCTION payouts.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Payout history is append-only'; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['PayoutBeneficiaries','PayoutAttempts','PayoutProviderEvents','PayoutReconciliationHistory'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON payouts.%I FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change()', t);
    EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON payouts.%I FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change()', t);
  END LOOP;
END $$;
CREATE TRIGGER no_payout_delete BEFORE DELETE ON payouts."PayoutObligations" FOR EACH ROW EXECUTE FUNCTION payouts.reject_history_change();
CREATE TRIGGER no_payout_truncate BEFORE TRUNCATE ON payouts."PayoutObligations" FOR EACH STATEMENT EXECUTE FUNCTION payouts.reject_history_change();
ALTER TABLE payouts."PayoutBeneficiaries" ADD CONSTRAINT "CK_Beneficiary_Masked" CHECK ("MaskedAccountNumber" ~ '^\*{4}[0-9]{4}$' AND "Ifsc" ~ '^[A-Z]{4}0[A-Z0-9]{6}$' AND "Provider" = 'FAKE');
ALTER TABLE payouts."PayoutBeneficiaries" ADD CONSTRAINT "FK_Beneficiary_User" FOREIGN KEY ("UserId") REFERENCES identity.users("Id");
ALTER TABLE payouts."PayoutObligations" ADD CONSTRAINT "FK_Payout_Cycle" FOREIGN KEY ("CycleId","GroupId") REFERENCES groups."MonthlyCycles"("Id","GroupId");
ALTER TABLE payouts."PayoutObligations" ADD CONSTRAINT "FK_Payout_Member" FOREIGN KEY ("MembershipId","GroupId") REFERENCES groups."GroupMemberships"("Id","GroupId");
ALTER TABLE payouts."PayoutObligations" ADD CONSTRAINT "FK_Payout_Selection" FOREIGN KEY ("SelectionResultId") REFERENCES groups."SelectionResults"("Id");
ALTER TABLE payouts."PayoutObligations" ADD CONSTRAINT "FK_Payout_AllocationJournal" FOREIGN KEY ("AllocationJournalId") REFERENCES ledger."JournalEntries"("Id");
ALTER TABLE payouts."PayoutObligations" ADD CONSTRAINT "FK_Payout_SettlementJournal" FOREIGN KEY ("SettlementJournalId") REFERENCES ledger."JournalEntries"("Id");
CREATE FUNCTION payouts.guard_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER payout_source_guard BEFORE INSERT OR UPDATE ON payouts."PayoutObligations" FOR EACH ROW EXECUTE FUNCTION payouts.guard_obligation();
CREATE FUNCTION payouts.guard_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER payout_attempt_guard BEFORE INSERT ON payouts."PayoutAttempts" FOR EACH ROW EXECUTE FUNCTION payouts.guard_attempt();
CREATE FUNCTION payouts.check_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER payout_settlement_consistency AFTER INSERT OR UPDATE ON payouts."PayoutObligations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_settlement();
CREATE UNIQUE INDEX "IX_OneCollectingCycle" ON groups."MonthlyCycles" ("GroupId") WHERE "Status" = 'CollectingContributions';
CREATE FUNCTION payouts.check_cycle_completion() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER payout_cycle_consistency AFTER UPDATE ON groups."MonthlyCycles" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_cycle_completion();
CREATE FUNCTION payouts.guard_completed_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."CompletedAt" IS NOT NULL AND ROW(NEW."Status",NEW."CompletedAt",NEW."PayoutCompletedAt") IS DISTINCT FROM ROW(OLD."Status",OLD."CompletedAt",OLD."PayoutCompletedAt") THEN RAISE EXCEPTION 'Completed cycle settlement cannot regress'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_completed_cycle_guard BEFORE UPDATE ON groups."MonthlyCycles" FOR EACH ROW EXECUTE FUNCTION payouts.guard_completed_cycle();
CREATE FUNCTION payouts.check_group_completion() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER payout_group_consistency AFTER UPDATE ON groups."Groups" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payouts.check_group_completion();
CREATE FUNCTION payouts.guard_provider_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payouts."PayoutAttempts" a WHERE a."Id" = NEW."PayoutAttemptId" AND a."PayoutObligationId" = NEW."PayoutObligationId" AND a."ProviderPayoutId" = NEW."ProviderPayoutId" AND a."Provider" = NEW."Provider") THEN RAISE EXCEPTION 'Provider event must match its attempt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_event_source_guard BEFORE INSERT ON payouts."PayoutProviderEvents" FOR EACH ROW EXECUTE FUNCTION payouts.guard_provider_event();
""";
}
