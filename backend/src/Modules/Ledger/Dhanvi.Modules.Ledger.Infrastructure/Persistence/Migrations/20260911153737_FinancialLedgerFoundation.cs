using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF-generated migration arrays are used once during schema application.

namespace Dhanvi.Modules.Ledger.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FinancialLedgerFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "ledger");

            migrationBuilder.CreateSequence(
                name: "JournalNumberSequence",
                schema: "ledger");

            migrationBuilder.CreateTable(
                name: "JournalEntries",
                schema: "ledger",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JournalNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    EventType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    EventId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    BusinessDate = table.Column<DateOnly>(type: "date", nullable: false),
                    BusinessTimeZone = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PostedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PostedBy = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CorrelationId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SourceModule = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    SourceFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PolicyVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    FeePolicy = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReversesJournalEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReversalReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    LineCount = table.Column<int>(type: "integer", nullable: false),
                    DebitTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreditTotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalEntries", x => x.Id);
                    table.CheckConstraint("CK_Journal_Posted", "\"Status\" = 'POSTED' AND \"LineCount\" >= 2 AND \"DebitTotal\" > 0 AND \"DebitTotal\" = \"CreditTotal\"");
                    table.CheckConstraint("CK_Journal_Reversal", "(\"EventType\" = 'AccountingReversal' AND \"ReversesJournalEntryId\" IS NOT NULL AND length(trim(\"ReversalReason\")) > 0) OR (\"EventType\" <> 'AccountingReversal' AND \"ReversesJournalEntryId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_JournalEntries_JournalEntries_ReversesJournalEntryId",
                        column: x => x.ReversesJournalEntryId,
                        principalSchema: "ledger",
                        principalTable: "JournalEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "LedgerAccounts",
                schema: "ledger",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    AccountType = table.Column<string>(type: "text", nullable: false),
                    NormalBalance = table.Column<string>(type: "text", nullable: false),
                    IsSystem = table.Column<bool>(type: "boolean", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LedgerAccounts", x => x.Id);
                    table.CheckConstraint("CK_Account_Normal", "(\"AccountType\" IN ('Asset','Expense') AND \"NormalBalance\" = 'Debit') OR (\"AccountType\" IN ('Liability','Equity','Revenue') AND \"NormalBalance\" = 'Credit')");
                    table.CheckConstraint("CK_Account_Type", "\"AccountType\" IN ('Asset','Liability','Equity','Revenue','Expense')");
                });

            migrationBuilder.CreateTable(
                name: "JournalLines",
                schema: "ledger",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    JournalEntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    AccountId = table.Column<Guid>(type: "uuid", nullable: false),
                    DebitAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreditAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: true),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: true),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: true),
                    SelectionResultId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuctionResultId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReferenceType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ReferenceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_JournalLines", x => x.Id);
                    table.CheckConstraint("CK_Line_Currency", "\"Currency\" = 'INR'");
                    table.CheckConstraint("CK_Line_Sides", "(\"DebitAmount\" > 0 AND \"CreditAmount\" = 0) OR (\"CreditAmount\" > 0 AND \"DebitAmount\" = 0)");
                    table.ForeignKey(
                        name: "FK_JournalLines_JournalEntries_JournalEntryId",
                        column: x => x.JournalEntryId,
                        principalSchema: "ledger",
                        principalTable: "JournalEntries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_JournalLines_LedgerAccounts_AccountId",
                        column: x => x.AccountId,
                        principalSchema: "ledger",
                        principalTable: "LedgerAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_BusinessDate",
                schema: "ledger",
                table: "JournalEntries",
                column: "BusinessDate");

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_EventId",
                schema: "ledger",
                table: "JournalEntries",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_EventType_EventId",
                schema: "ledger",
                table: "JournalEntries",
                columns: new[] { "EventType", "EventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_IdempotencyKey",
                schema: "ledger",
                table: "JournalEntries",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_JournalNumber",
                schema: "ledger",
                table: "JournalEntries",
                column: "JournalNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_PostedAt",
                schema: "ledger",
                table: "JournalEntries",
                column: "PostedAt");

            migrationBuilder.CreateIndex(
                name: "IX_JournalEntries_ReversesJournalEntryId",
                schema: "ledger",
                table: "JournalEntries",
                column: "ReversesJournalEntryId",
                unique: true,
                filter: "\"ReversesJournalEntryId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_AccountId",
                schema: "ledger",
                table: "JournalLines",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_AuctionResultId",
                schema: "ledger",
                table: "JournalLines",
                column: "AuctionResultId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_CycleId",
                schema: "ledger",
                table: "JournalLines",
                column: "CycleId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_GroupId",
                schema: "ledger",
                table: "JournalLines",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_JournalEntryId",
                schema: "ledger",
                table: "JournalLines",
                column: "JournalEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_MembershipId",
                schema: "ledger",
                table: "JournalLines",
                column: "MembershipId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_SelectionResultId",
                schema: "ledger",
                table: "JournalLines",
                column: "SelectionResultId");

            migrationBuilder.CreateIndex(
                name: "IX_LedgerAccounts_Code",
                schema: "ledger",
                table: "LedgerAccounts",
                column: "Code",
                unique: true);
            LedgerDatabaseGuards.Up(migrationBuilder);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "JournalLines",
                schema: "ledger");

            migrationBuilder.DropTable(
                name: "JournalEntries",
                schema: "ledger");

            migrationBuilder.DropTable(
                name: "LedgerAccounts",
                schema: "ledger");

            migrationBuilder.DropSequence(
                name: "JournalNumberSequence",
                schema: "ledger");
            LedgerDatabaseGuards.Down(migrationBuilder);
        }
    }
}
