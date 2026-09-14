using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF-generated migration array arguments.

namespace Dhanvi.Modules.Payouts.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OutgoingPayoutSettlement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "payouts");

            migrationBuilder.CreateTable(
                name: "FakeProviderPayouts",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "text", nullable: false),
                    FundAccountId = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Reference = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FakeProviderPayouts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PayoutBeneficiaries",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    ProviderFundAccountId = table.Column<string>(type: "text", nullable: false),
                    AccountType = table.Column<string>(type: "text", nullable: false),
                    MaskedAccountNumber = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    AccountHolderName = table.Column<string>(type: "text", nullable: false),
                    BankName = table.Column<string>(type: "text", nullable: false),
                    Ifsc = table.Column<string>(type: "character varying(11)", maxLength: 11, nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AvailableAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutBeneficiaries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PayoutObligations",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupName = table.Column<string>(type: "text", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    MemberName = table.Column<string>(type: "text", nullable: false),
                    SelectionResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuctionResultId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayoutType = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    TimeZone = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    BeneficiaryId = table.Column<Guid>(type: "uuid", nullable: true),
                    ApprovedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    AllocationJournalId = table.Column<Guid>(type: "uuid", nullable: false),
                    SettlementJournalId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SettledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutObligations", x => x.Id);
                    table.CheckConstraint("CK_Payout_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR'");
                    table.CheckConstraint("CK_Payout_Recipient", "(\"PayoutType\" = 'PlatformFeeSettlement' AND \"UserId\" IS NULL AND \"MembershipId\" IS NULL) OR (\"PayoutType\" IN ('WinnerPayout','MemberAuctionBenefit') AND \"UserId\" IS NOT NULL AND \"MembershipId\" IS NOT NULL)");
                    table.CheckConstraint("CK_Payout_Settled", "(\"Status\" = 'Succeeded') = (\"SettledAt\" IS NOT NULL AND \"SettlementJournalId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_PayoutObligations_PayoutBeneficiaries_BeneficiaryId",
                        column: x => x.BeneficiaryId,
                        principalSchema: "payouts",
                        principalTable: "PayoutBeneficiaries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayoutAttempts",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PayoutObligationId = table.Column<Guid>(type: "uuid", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    ProviderPayoutId = table.Column<string>(type: "text", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "text", nullable: false),
                    RequestKey = table.Column<string>(type: "text", nullable: false),
                    BeneficiaryId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderFundAccountId = table.Column<string>(type: "text", nullable: false),
                    MaskedAccountNumber = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    RequestedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutAttempts", x => x.Id);
                    table.CheckConstraint("CK_Attempt_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR' AND \"Provider\" = 'FAKE'");
                    table.ForeignKey(
                        name: "FK_PayoutAttempts_PayoutBeneficiaries_BeneficiaryId",
                        column: x => x.BeneficiaryId,
                        principalSchema: "payouts",
                        principalTable: "PayoutBeneficiaries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayoutAttempts_PayoutObligations_PayoutObligationId",
                        column: x => x.PayoutObligationId,
                        principalSchema: "payouts",
                        principalTable: "PayoutObligations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayoutReconciliationHistory",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PayoutObligationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutReconciliationHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayoutReconciliationHistory_PayoutObligations_PayoutObligat~",
                        column: x => x.PayoutObligationId,
                        principalSchema: "payouts",
                        principalTable: "PayoutObligations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PayoutProviderEvents",
                schema: "payouts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PayoutObligationId = table.Column<Guid>(type: "uuid", nullable: false),
                    PayoutAttemptId = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    ProviderPayoutId = table.Column<string>(type: "text", nullable: false),
                    ProviderEventId = table.Column<string>(type: "text", nullable: false),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Matched = table.Column<bool>(type: "boolean", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PayoutProviderEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PayoutProviderEvents_PayoutAttempts_PayoutAttemptId",
                        column: x => x.PayoutAttemptId,
                        principalSchema: "payouts",
                        principalTable: "PayoutAttempts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PayoutProviderEvents_PayoutObligations_PayoutObligationId",
                        column: x => x.PayoutObligationId,
                        principalSchema: "payouts",
                        principalTable: "PayoutObligations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FakeProviderPayouts_IdempotencyKey",
                schema: "payouts",
                table: "FakeProviderPayouts",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutAttempts_BeneficiaryId",
                schema: "payouts",
                table: "PayoutAttempts",
                column: "BeneficiaryId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutAttempts_IdempotencyKey",
                schema: "payouts",
                table: "PayoutAttempts",
                column: "IdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutAttempts_PayoutObligationId_AttemptNumber",
                schema: "payouts",
                table: "PayoutAttempts",
                columns: new[] { "PayoutObligationId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutAttempts_PayoutObligationId_RequestKey",
                schema: "payouts",
                table: "PayoutAttempts",
                columns: new[] { "PayoutObligationId", "RequestKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutAttempts_ProviderPayoutId",
                schema: "payouts",
                table: "PayoutAttempts",
                column: "ProviderPayoutId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutBeneficiaries_ProviderFundAccountId",
                schema: "payouts",
                table: "PayoutBeneficiaries",
                column: "ProviderFundAccountId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutBeneficiaries_UserId_CreatedAt",
                schema: "payouts",
                table: "PayoutBeneficiaries",
                columns: new[] { "UserId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_BeneficiaryId",
                schema: "payouts",
                table: "PayoutObligations",
                column: "BeneficiaryId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_CycleId_MembershipId",
                schema: "payouts",
                table: "PayoutObligations",
                columns: new[] { "CycleId", "MembershipId" },
                unique: true,
                filter: "\"PayoutType\" = 'MemberAuctionBenefit'");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_CycleId_PayoutType",
                schema: "payouts",
                table: "PayoutObligations",
                columns: new[] { "CycleId", "PayoutType" },
                unique: true,
                filter: "\"PayoutType\" IN ('WinnerPayout','PlatformFeeSettlement')");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_CycleId_PayoutType_SourceId",
                schema: "payouts",
                table: "PayoutObligations",
                columns: new[] { "CycleId", "PayoutType", "SourceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_GroupId",
                schema: "payouts",
                table: "PayoutObligations",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_Status",
                schema: "payouts",
                table: "PayoutObligations",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutObligations_UserId",
                schema: "payouts",
                table: "PayoutObligations",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutProviderEvents_PayoutAttemptId",
                schema: "payouts",
                table: "PayoutProviderEvents",
                column: "PayoutAttemptId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutProviderEvents_PayoutObligationId",
                schema: "payouts",
                table: "PayoutProviderEvents",
                column: "PayoutObligationId");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutProviderEvents_Provider_ProviderEventId",
                schema: "payouts",
                table: "PayoutProviderEvents",
                columns: new[] { "Provider", "ProviderEventId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PayoutReconciliationHistory_PayoutObligationId_CreatedAt",
                schema: "payouts",
                table: "PayoutReconciliationHistory",
                columns: new[] { "PayoutObligationId", "CreatedAt" });
            migrationBuilder.Sql(PayoutDatabaseGuards.Sql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS payout_cycle_consistency ON groups.\"MonthlyCycles\"; DROP INDEX IF EXISTS groups.\"IX_OneCollectingCycle\"; DROP FUNCTION IF EXISTS payouts.check_cycle_completion();");
            migrationBuilder.Sql("DROP TRIGGER IF EXISTS payout_completed_cycle_guard ON groups.\"MonthlyCycles\"; DROP TRIGGER IF EXISTS payout_group_consistency ON groups.\"Groups\"; DROP FUNCTION IF EXISTS payouts.guard_completed_cycle(); DROP FUNCTION IF EXISTS payouts.check_group_completion();");
            migrationBuilder.DropTable(
                name: "FakeProviderPayouts",
                schema: "payouts");

            migrationBuilder.DropTable(
                name: "PayoutProviderEvents",
                schema: "payouts");

            migrationBuilder.DropTable(
                name: "PayoutReconciliationHistory",
                schema: "payouts");

            migrationBuilder.DropTable(
                name: "PayoutAttempts",
                schema: "payouts");

            migrationBuilder.DropTable(
                name: "PayoutObligations",
                schema: "payouts");

            migrationBuilder.DropTable(
                name: "PayoutBeneficiaries",
                schema: "payouts");
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS payouts.reject_history_change(); DROP FUNCTION IF EXISTS payouts.guard_obligation(); DROP FUNCTION IF EXISTS payouts.guard_attempt(); DROP FUNCTION IF EXISTS payouts.check_settlement(); DROP FUNCTION IF EXISTS payouts.guard_provider_event();");
        }
    }
}
