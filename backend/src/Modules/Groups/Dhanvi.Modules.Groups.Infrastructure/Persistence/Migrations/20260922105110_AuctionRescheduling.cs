using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // Preserve EF-generated migration array literals.

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AuctionRescheduling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastRescheduledAt",
                schema: "groups",
                table: "Auctions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LatestMemberMessage",
                schema: "groups",
                table: "Auctions",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LatestReasonCode",
                schema: "groups",
                table: "Auctions",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OriginalEndsAt",
                schema: "groups",
                table: "Auctions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "OriginalStartsAt",
                schema: "groups",
                table: "Auctions",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PreviousEndsAt",
                schema: "groups",
                table: "Auctions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PreviousStartsAt",
                schema: "groups",
                table: "Auctions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RescheduleCount",
                schema: "groups",
                table: "Auctions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "AuctionScheduleChanges",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AuctionId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChangeSequence = table.Column<int>(type: "integer", nullable: false),
                    PreviousStartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PreviousEndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    NewStartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    NewEndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReasonCode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    ReasonText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    MemberMessage = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ChangedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChangedByRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ChangedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuctionScheduleChanges", x => x.Id);
                    table.CheckConstraint("CK_AuctionScheduleChange_Reason", "\"ReasonCode\" <> 'Other' OR length(trim(\"ReasonText\")) >= 5");
                    table.CheckConstraint("CK_AuctionScheduleChange_Role", "\"ChangedByRole\" IN ('ADMIN', 'ORGANIZER')");
                    table.CheckConstraint("CK_AuctionScheduleChange_Windows", "\"PreviousStartsAt\" < \"PreviousEndsAt\" AND \"NewStartsAt\" < \"NewEndsAt\" AND \"ChangeSequence\" > 0");
                    table.ForeignKey(
                        name: "FK_AuctionScheduleChanges_Auctions_AuctionId_GroupId_CycleId",
                        columns: x => new { x.AuctionId, x.GroupId, x.CycleId },
                        principalSchema: "groups",
                        principalTable: "Auctions",
                        principalColumns: new[] { "Id", "GroupId", "CycleId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionScheduleChanges_AuctionId_ChangeSequence",
                schema: "groups",
                table: "AuctionScheduleChanges",
                columns: new[] { "AuctionId", "ChangeSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionScheduleChanges_AuctionId_GroupId_CycleId",
                schema: "groups",
                table: "AuctionScheduleChanges",
                columns: new[] { "AuctionId", "GroupId", "CycleId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionScheduleChanges_GroupId_CycleId_ChangedAt",
                schema: "groups",
                table: "AuctionScheduleChanges",
                columns: new[] { "GroupId", "CycleId", "ChangedAt" });

            // Auctions that existed before this migration keep their current window as the original one.
            migrationBuilder.Sql("""UPDATE groups."Auctions" SET "OriginalStartsAt" = "StartsAt", "OriginalEndsAt" = "EndsAt";""");
            // Schedule history is append-only: no UPDATE, DELETE or TRUNCATE through any connection (same pattern as payment history).
            migrationBuilder.Sql("""
                CREATE FUNCTION groups.reject_schedule_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Auction schedule history is immutable'; END; $$;
                CREATE TRIGGER auction_schedule_changes_immutable BEFORE UPDATE OR DELETE ON groups."AuctionScheduleChanges"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_schedule_history_mutation();
                CREATE TRIGGER auction_schedule_changes_no_truncate BEFORE TRUNCATE ON groups."AuctionScheduleChanges"
                    EXECUTE FUNCTION groups.reject_schedule_history_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER auction_schedule_changes_no_truncate ON groups."AuctionScheduleChanges";
                DROP TRIGGER auction_schedule_changes_immutable ON groups."AuctionScheduleChanges";
                DROP FUNCTION groups.reject_schedule_history_mutation();
                """);
            migrationBuilder.DropTable(
                name: "AuctionScheduleChanges",
                schema: "groups");

            migrationBuilder.DropColumn(
                name: "LastRescheduledAt",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "LatestMemberMessage",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "LatestReasonCode",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "OriginalEndsAt",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "OriginalStartsAt",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "PreviousEndsAt",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "PreviousStartsAt",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropColumn(
                name: "RescheduleCount",
                schema: "groups",
                table: "Auctions");
        }
    }
}
