using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dhanvi.Modules.Ledger.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RazorpayTestPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ContributionId",
                schema: "ledger",
                table: "JournalLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PaymentId",
                schema: "ledger",
                table: "JournalLines",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_ContributionId",
                schema: "ledger",
                table: "JournalLines",
                column: "ContributionId");

            migrationBuilder.CreateIndex(
                name: "IX_JournalLines_PaymentId",
                schema: "ledger",
                table: "JournalLines",
                column: "PaymentId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_JournalLines_ContributionId",
                schema: "ledger",
                table: "JournalLines");

            migrationBuilder.DropIndex(
                name: "IX_JournalLines_PaymentId",
                schema: "ledger",
                table: "JournalLines");

            migrationBuilder.DropColumn(
                name: "ContributionId",
                schema: "ledger",
                table: "JournalLines");

            migrationBuilder.DropColumn(
                name: "PaymentId",
                schema: "ledger",
                table: "JournalLines");
        }
    }
}
