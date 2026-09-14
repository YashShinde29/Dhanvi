namespace Dhanvi.Modules.Payments.Infrastructure.Persistence;

// Cross-module constraints are installed after Groups and Ledger migrations.
internal static class PaymentDatabaseProtections
{
    public const string Up = """
        CREATE FUNCTION payments.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Payment history is immutable'; END; $$;
        CREATE TRIGGER events_immutable BEFORE UPDATE OR DELETE ON payments."PaymentProviderEvents"
            FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON payments."PaymentHistory"
            FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER refunds_immutable BEFORE UPDATE OR DELETE ON payments."PaymentRefunds"
            FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments."Payments"
            FOR EACH ROW EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON payments."PaymentProviderEvents" EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON payments."PaymentHistory" EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER refunds_no_truncate BEFORE TRUNCATE ON payments."PaymentRefunds" EXECUTE FUNCTION payments.reject_history_mutation();
        CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON payments."Payments" EXECUTE FUNCTION payments.reject_history_mutation();

        ALTER TABLE payments."Payments" ADD CONSTRAINT "FK_Payment_Contribution" FOREIGN KEY ("ContributionId") REFERENCES groups."Contributions" ("Id") ON DELETE RESTRICT;
        ALTER TABLE payments."Payments" ADD CONSTRAINT "FK_Payment_User" FOREIGN KEY ("UserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
        ALTER TABLE payments."Payments" ADD CONSTRAINT "FK_Payment_Journal" FOREIGN KEY ("JournalId") REFERENCES ledger."JournalEntries" ("Id") ON DELETE RESTRICT;
        ALTER TABLE payments."Payments" ADD CONSTRAINT "FK_Payment_Reversal" FOREIGN KEY ("ReversalJournalId") REFERENCES ledger."JournalEntries" ("Id") ON DELETE RESTRICT;
        ALTER TABLE groups."Contributions" ADD CONSTRAINT "FK_Contribution_SettledPayment" FOREIGN KEY ("SettledPaymentId") REFERENCES payments."Payments" ("Id") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Line_Payment" FOREIGN KEY ("PaymentId") REFERENCES payments."Payments" ("Id") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Line_Contribution" FOREIGN KEY ("ContributionId") REFERENCES groups."Contributions" ("Id") ON DELETE RESTRICT;
        ALTER TABLE payments."Payments" ADD CONSTRAINT "CK_Payment_State" CHECK (
            "Status" IN ('Created','Pending','Authorized','Captured','Failed','Cancelled','RefundPending','Refunded','ReconciliationRequired')
            AND "AttemptNumber" > 0 AND length(trim("IdempotencyKey")) > 0
            AND ("Status" NOT IN ('Authorized','Captured','RefundPending','Refunded') OR "ProviderPaymentId" IS NOT NULL)
            AND ("Status" NOT IN ('Captured','RefundPending','Refunded') OR "CapturedAt" IS NOT NULL)
            AND (("RefundedAt" IS NULL AND "ReversalJournalId" IS NULL) OR ("RefundedAt" IS NOT NULL AND "ReversalJournalId" IS NOT NULL AND "SettledAt" IS NOT NULL)));
        ALTER TABLE payments."PaymentRefunds" ADD CONSTRAINT "CK_Refund_State" CHECK ("Amount" > 0 AND length(trim("ProviderRefundId")) > 0 AND "Status" IN ('pending','processed','failed'));

        CREATE FUNCTION payments.protect_payment() RETURNS trigger LANGUAGE plpgsql AS $$
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
        CREATE TRIGGER payment_protected BEFORE UPDATE ON payments."Payments" FOR EACH ROW EXECUTE FUNCTION payments.protect_payment();

        CREATE FUNCTION payments.check_payment_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
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
        CREATE CONSTRAINT TRIGGER payment_consistent AFTER INSERT OR UPDATE ON payments."Payments"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_payment_consistency();

        CREATE FUNCTION payments.check_contribution_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE c groups."Contributions";
        BEGIN
            SELECT * INTO c FROM groups."Contributions" WHERE "Id" = NEW."Id";
            IF c."SettledPaymentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payments."Payments" p WHERE p."Id" = c."SettledPaymentId" AND p."ContributionId" = c."Id" AND p."SettledAt" IS NOT NULL AND p."RefundedAt" IS NULL AND p."Amount" = c."FinanciallySettledAmount")
            THEN RAISE EXCEPTION 'Contribution requires its settled payment'; END IF;
            IF EXISTS (SELECT 1 FROM payments."Payments" p WHERE p."ContributionId" = c."Id" AND p."SettledAt" IS NOT NULL AND p."RefundedAt" IS NULL AND p."Id" IS DISTINCT FROM c."SettledPaymentId")
            THEN RAISE EXCEPTION 'Contribution settlement cannot be removed without refund'; END IF;
            RETURN NULL;
        END; $$;
        CREATE CONSTRAINT TRIGGER contribution_settlement_consistent AFTER INSERT OR UPDATE ON groups."Contributions"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_contribution_settlement();

        CREATE FUNCTION payments.protect_financial_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW."CollectionMode" IS DISTINCT FROM OLD."CollectionMode" OR
                (OLD."SelectionResultId" IS NOT NULL AND ROW(NEW."FinanciallySettledAmount",NEW."FinanciallySettledMemberCount") IS DISTINCT FROM ROW(OLD."FinanciallySettledAmount",OLD."FinanciallySettledMemberCount"))
            THEN RAISE EXCEPTION 'Cycle collection mode and selected finances are immutable'; END IF;
            RETURN NEW;
        END; $$;
        CREATE TRIGGER financial_cycle_protected BEFORE UPDATE ON groups."MonthlyCycles" FOR EACH ROW EXECUTE FUNCTION payments.protect_financial_cycle();
        CREATE FUNCTION payments.check_cycle_finances() RETURNS trigger LANGUAGE plpgsql AS $$
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
        CREATE CONSTRAINT TRIGGER cycle_finances_consistent AFTER INSERT OR UPDATE ON groups."MonthlyCycles"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_cycle_finances();
        CREATE CONSTRAINT TRIGGER contribution_cycle_finances AFTER INSERT OR UPDATE ON groups."Contributions"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payments.check_cycle_finances();
        """;

    public const string Down = """
        DROP TRIGGER contribution_cycle_finances ON groups."Contributions";
        DROP TRIGGER cycle_finances_consistent ON groups."MonthlyCycles";
        DROP TRIGGER financial_cycle_protected ON groups."MonthlyCycles";
        DROP TRIGGER contribution_settlement_consistent ON groups."Contributions";
        ALTER TABLE groups."Contributions" DROP CONSTRAINT "FK_Contribution_SettledPayment";
        ALTER TABLE ledger."JournalLines" DROP CONSTRAINT "FK_Line_Payment", DROP CONSTRAINT "FK_Line_Contribution";
        DROP FUNCTION payments.check_cycle_finances();
        DROP FUNCTION payments.protect_financial_cycle();
        DROP FUNCTION payments.check_contribution_settlement();
        """;
}
