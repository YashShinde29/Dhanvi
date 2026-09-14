using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RazorpayTestPayments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CollectionMode",
                schema: "groups",
                table: "MonthlyCycles",
                type: "text",
                nullable: false,
                defaultValue: "ManualTracking");

            migrationBuilder.AddColumn<decimal>(
                name: "FinanciallySettledAmount",
                schema: "groups",
                table: "MonthlyCycles",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "FinanciallySettledMemberCount",
                schema: "groups",
                table: "MonthlyCycles",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "FinancialStatus",
                schema: "groups",
                table: "Contributions",
                type: "text",
                nullable: false,
                defaultValue: "Unpaid");

            migrationBuilder.AddColumn<decimal>(
                name: "FinanciallySettledAmount",
                schema: "groups",
                table: "Contributions",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<Guid>(
                name: "SettledPaymentId",
                schema: "groups",
                table: "Contributions",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Cycle_Financial",
                schema: "groups",
                table: "MonthlyCycles",
                sql: "\"FinanciallySettledAmount\" BETWEEN 0 AND \"ExpectedPoolAmount\" AND \"FinanciallySettledMemberCount\" BETWEEN 0 AND \"ExpectedMemberCount\"");

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_SettledPaymentId",
                schema: "groups",
                table: "Contributions",
                column: "SettledPaymentId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Contribution_Financial",
                schema: "groups",
                table: "Contributions",
                sql: "(\"FinanciallySettledAmount\" = 0 AND \"SettledPaymentId\" IS NULL AND \"FinancialStatus\" IN ('Unpaid','Refunded')) OR (\"FinanciallySettledAmount\" = \"ExpectedAmount\" AND \"SettledPaymentId\" IS NOT NULL AND \"FinancialStatus\" = 'Settled')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Cycle_Financial",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropIndex(
                name: "IX_Contributions_SettledPaymentId",
                schema: "groups",
                table: "Contributions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Contribution_Financial",
                schema: "groups",
                table: "Contributions");

            migrationBuilder.DropColumn(
                name: "CollectionMode",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "FinanciallySettledAmount",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "FinanciallySettledMemberCount",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "FinancialStatus",
                schema: "groups",
                table: "Contributions");

            migrationBuilder.DropColumn(
                name: "FinanciallySettledAmount",
                schema: "groups",
                table: "Contributions");

            migrationBuilder.DropColumn(
                name: "SettledPaymentId",
                schema: "groups",
                table: "Contributions");
        }
    }
}
