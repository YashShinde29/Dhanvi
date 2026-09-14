using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PayoutCycleCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CompletedAt",
                schema: "groups",
                table: "MonthlyCycles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PayoutCompletedAt",
                schema: "groups",
                table: "MonthlyCycles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CompletedAt",
                schema: "groups",
                table: "Groups",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedAt",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "PayoutCompletedAt",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "CompletedAt",
                schema: "groups",
                table: "Groups");
        }
    }
}
