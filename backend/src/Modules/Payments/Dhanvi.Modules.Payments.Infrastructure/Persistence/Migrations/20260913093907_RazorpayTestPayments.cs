using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF-generated migration array arguments.

namespace Dhanvi.Modules.Payments.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RazorpayTestPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "payments");

            migrationBuilder.CreateTable(
                name: "Payments",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContributionId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupName = table.Column<string>(type: "text", nullable: false),
                    MemberName = table.Column<string>(type: "text", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    BusinessTimeZone = table.Column<string>(type: "text", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    Environment = table.Column<string>(type: "text", nullable: false),
                    ProviderOrderId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderPaymentId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Currency = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Receipt = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AuthorizedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CapturedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RefundedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SettledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    JournalId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReversalJournalId = table.Column<Guid>(type: "uuid", nullable: true),
                    FailureCode = table.Column<string>(type: "text", nullable: true),
                    FailureReason = table.Column<string>(type: "text", nullable: true),
                    ReconciliationStatus = table.Column<string>(type: "text", nullable: false),
                    LastReconciledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReconciliationMessage = table.Column<string>(type: "text", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Payments", x => x.Id);
                    table.CheckConstraint("CK_Payment_Money", "\"Amount\" > 0 AND \"Currency\" = 'INR' AND \"Environment\" = 'TEST' AND \"Provider\" = 'RAZORPAY'");
                    table.CheckConstraint("CK_Payment_Settled", "\"SettledAt\" IS NULL OR (\"CapturedAt\" IS NOT NULL AND \"JournalId\" IS NOT NULL AND \"ProviderPaymentId\" IS NOT NULL)");
                });

            migrationBuilder.CreateTable(
                name: "PaymentHistory",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentHistory", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentHistory_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalSchema: "payments",
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentProviderEvents",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "text", nullable: false),
                    EventKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EventType = table.Column<string>(type: "text", nullable: false),
                    PayloadHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ProviderOrderId = table.Column<string>(type: "text", nullable: true),
                    ProviderPaymentId = table.Column<string>(type: "text", nullable: true),
                    PaymentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ProcessedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ProcessingStatus = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentProviderEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentProviderEvents_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalSchema: "payments",
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PaymentRefunds",
                schema: "payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PaymentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderRefundId = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PaymentRefunds", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PaymentRefunds_Payments_PaymentId",
                        column: x => x.PaymentId,
                        principalSchema: "payments",
                        principalTable: "Payments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentHistory_PaymentId_CreatedAt",
                schema: "payments",
                table: "PaymentHistory",
                columns: new[] { "PaymentId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentProviderEvents_PaymentId",
                schema: "payments",
                table: "PaymentProviderEvents",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentProviderEvents_Provider_EventKey",
                schema: "payments",
                table: "PaymentProviderEvents",
                columns: new[] { "Provider", "EventKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefunds_PaymentId",
                schema: "payments",
                table: "PaymentRefunds",
                column: "PaymentId");

            migrationBuilder.CreateIndex(
                name: "IX_PaymentRefunds_ProviderRefundId_Status",
                schema: "payments",
                table: "PaymentRefunds",
                columns: new[] { "ProviderRefundId", "Status" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ContributionId",
                schema: "payments",
                table: "Payments",
                column: "ContributionId",
                unique: true,
                filter: "\"RefundedAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ContributionId_AttemptNumber",
                schema: "payments",
                table: "Payments",
                columns: new[] { "ContributionId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ContributionId_IdempotencyKey",
                schema: "payments",
                table: "Payments",
                columns: new[] { "ContributionId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_CycleId",
                schema: "payments",
                table: "Payments",
                column: "CycleId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_GroupId",
                schema: "payments",
                table: "Payments",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_MembershipId",
                schema: "payments",
                table: "Payments",
                column: "MembershipId");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ProviderOrderId",
                schema: "payments",
                table: "Payments",
                column: "ProviderOrderId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ProviderPaymentId",
                schema: "payments",
                table: "Payments",
                column: "ProviderPaymentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_Receipt",
                schema: "payments",
                table: "Payments",
                column: "Receipt",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_ReconciliationStatus",
                schema: "payments",
                table: "Payments",
                column: "ReconciliationStatus");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_Status",
                schema: "payments",
                table: "Payments",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_Payments_UserId",
                schema: "payments",
                table: "Payments",
                column: "UserId");
            migrationBuilder.Sql(PaymentDatabaseProtections.Up);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(PaymentDatabaseProtections.Down);
            migrationBuilder.DropTable(
                name: "PaymentHistory",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "PaymentProviderEvents",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "PaymentRefunds",
                schema: "payments");

            migrationBuilder.DropTable(
                name: "Payments",
                schema: "payments");
            migrationBuilder.Sql("DROP FUNCTION payments.check_payment_consistency(); DROP FUNCTION payments.protect_payment(); DROP FUNCTION payments.reject_history_mutation();");
        }
    }
}
