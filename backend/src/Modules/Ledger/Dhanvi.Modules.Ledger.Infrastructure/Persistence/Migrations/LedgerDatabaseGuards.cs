using Microsoft.EntityFrameworkCore.Migrations;
namespace Dhanvi.Modules.Ledger.Infrastructure.Persistence.Migrations;

// SQL-only cross-row and cross-module protections; no duplicate source entities in the Ledger model.
internal static class LedgerDatabaseGuards
{
    public static void Up(MigrationBuilder migration) => migration.Sql("""
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "CK_Line_Dimensions"
          CHECK (("CycleId" IS NULL AND "MembershipId" IS NULL AND "SelectionResultId" IS NULL AND "AuctionResultId" IS NULL) OR "GroupId" IS NOT NULL);
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Ledger_Group" FOREIGN KEY ("GroupId") REFERENCES groups."Groups" ("Id") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Ledger_Cycle" FOREIGN KEY ("CycleId", "GroupId") REFERENCES groups."MonthlyCycles" ("Id", "GroupId") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Ledger_Membership" FOREIGN KEY ("MembershipId", "GroupId") REFERENCES groups."GroupMemberships" ("Id", "GroupId") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Ledger_Selection" FOREIGN KEY ("SelectionResultId", "GroupId") REFERENCES groups."SelectionResults" ("Id", "GroupId") ON DELETE RESTRICT;
        ALTER TABLE ledger."JournalLines" ADD CONSTRAINT "FK_Ledger_Auction" FOREIGN KEY ("AuctionResultId", "GroupId") REFERENCES groups."AuctionResults" ("Id", "GroupId") ON DELETE RESTRICT;

        CREATE FUNCTION ledger.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN RAISE EXCEPTION 'Posted ledger history is append-only; use a reversal journal' USING ERRCODE = '23514'; END $body$;
        CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON ledger."JournalEntries" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();
        CREATE TRIGGER journal_line_immutable BEFORE UPDATE OR DELETE ON ledger."JournalLines" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();
        CREATE TRIGGER system_account_immutable BEFORE UPDATE OR DELETE ON ledger."LedgerAccounts" FOR EACH ROW EXECUTE FUNCTION ledger.reject_history_change();

        CREATE FUNCTION ledger.ensure_complete_journal() RETURNS trigger LANGUAGE plpgsql AS $body$
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
        END $body$;
        CREATE CONSTRAINT TRIGGER journal_complete AFTER INSERT ON ledger."JournalEntries"
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.ensure_complete_journal();
        CREATE CONSTRAINT TRIGGER journal_lines_complete AFTER INSERT ON ledger."JournalLines"
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.ensure_complete_journal();
        """);
    public static void Down(MigrationBuilder migration) => migration.Sql("""
        DROP FUNCTION ledger.ensure_complete_journal();
        DROP FUNCTION ledger.reject_history_change();
        """);
}
