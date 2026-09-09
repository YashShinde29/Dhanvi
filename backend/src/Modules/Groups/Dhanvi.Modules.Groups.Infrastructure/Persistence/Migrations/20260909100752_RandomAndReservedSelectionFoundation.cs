using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF Core generated migration code.

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RandomAndReservedSelectionFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "HasReceivedPayout",
                schema: "groups",
                table: "GroupMemberships",
                newName: "HasBeenSelectedForPayout");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "SelectionCompletedAt",
                schema: "groups",
                table: "MonthlyCycles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AlgorithmVersion",
                schema: "groups",
                table: "GroupAuditEvents",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CycleId",
                schema: "groups",
                table: "GroupAuditEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SelectionResultId",
                schema: "groups",
                table: "GroupAuditEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "WinnerMembershipId",
                schema: "groups",
                table: "GroupAuditEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_GroupMemberships_Id_UserId_GroupId",
                schema: "groups",
                table: "GroupMemberships",
                columns: new[] { "Id", "UserId", "GroupId" });

            migrationBuilder.CreateTable(
                name: "SelectionResults",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    SelectionMethod = table.Column<string>(type: "text", nullable: false),
                    WinnerMembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    WinnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WinnerSlotNumber = table.Column<int>(type: "integer", nullable: false),
                    EligibleMemberCount = table.Column<int>(type: "integer", nullable: false),
                    ExecutedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExecutedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RandomSourceType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    SeedCommitment = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    SeedReveal = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    EligibleSetHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    ResultHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SelectedIndex = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SelectionResults", x => x.Id);
                    table.UniqueConstraint("AK_SelectionResults_Id_GroupId", x => new { x.Id, x.GroupId });
                    table.CheckConstraint("CK_Selection_Count", "\"EligibleMemberCount\" BETWEEN 1 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"WinnerSlotNumber\" BETWEEN 1 AND 50");
                    table.CheckConstraint("CK_Selection_Method", "(\"SelectionMethod\" = 'Random' AND \"SelectedIndex\" IS NOT NULL AND \"SelectedIndex\" >= 0 AND \"SelectedIndex\" < \"EligibleMemberCount\" AND \"SeedReveal\" IS NOT NULL AND \"SeedCommitment\" IS NOT NULL AND \"EligibleSetHash\" IS NOT NULL) OR (\"SelectionMethod\" = 'OrganizerReserved' AND \"CycleNumber\" = 1 AND \"EligibleMemberCount\" = 1 AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_SelectionResults_GroupMemberships_WinnerMembershipId_Winner~",
                        columns: x => new { x.WinnerMembershipId, x.WinnerUserId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumns: new[] { "Id", "UserId", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SelectionResults_MonthlyCycles_CycleId_GroupId",
                        columns: x => new { x.CycleId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "MonthlyCycles",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SelectionEligibleMembers",
                schema: "groups",
                columns: table => new
                {
                    SelectionResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    SlotNumber = table.Column<int>(type: "integer", nullable: false),
                    Ordinal = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SelectionEligibleMembers", x => new { x.SelectionResultId, x.MembershipId });
                    table.CheckConstraint("CK_Eligible_Ordinal", "\"Ordinal\" BETWEEN 0 AND 49 AND \"SlotNumber\" BETWEEN 1 AND 50");
                    table.ForeignKey(
                        name: "FK_SelectionEligibleMembers_GroupMemberships_MembershipId_Grou~",
                        columns: x => new { x.MembershipId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SelectionEligibleMembers_SelectionResults_SelectionResultId~",
                        columns: x => new { x.SelectionResultId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "SelectionResults",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MonthlyCycles_SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles",
                column: "SelectionResultId");

            migrationBuilder.CreateIndex(
                name: "IX_SelectionEligibleMembers_MembershipId_GroupId",
                schema: "groups",
                table: "SelectionEligibleMembers",
                columns: new[] { "MembershipId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_SelectionEligibleMembers_SelectionResultId_GroupId",
                schema: "groups",
                table: "SelectionEligibleMembers",
                columns: new[] { "SelectionResultId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_SelectionEligibleMembers_SelectionResultId_Ordinal",
                schema: "groups",
                table: "SelectionEligibleMembers",
                columns: new[] { "SelectionResultId", "Ordinal" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SelectionEligibleMembers_SelectionResultId_SlotNumber",
                schema: "groups",
                table: "SelectionEligibleMembers",
                columns: new[] { "SelectionResultId", "SlotNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SelectionResults_CycleId",
                schema: "groups",
                table: "SelectionResults",
                column: "CycleId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SelectionResults_CycleId_GroupId",
                schema: "groups",
                table: "SelectionResults",
                columns: new[] { "CycleId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_SelectionResults_GroupId_CycleNumber",
                schema: "groups",
                table: "SelectionResults",
                columns: new[] { "GroupId", "CycleNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SelectionResults_GroupId_WinnerMembershipId",
                schema: "groups",
                table: "SelectionResults",
                columns: new[] { "GroupId", "WinnerMembershipId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SelectionResults_WinnerMembershipId_WinnerUserId_GroupId",
                schema: "groups",
                table: "SelectionResults",
                columns: new[] { "WinnerMembershipId", "WinnerUserId", "GroupId" });

            migrationBuilder.AddForeignKey(
                name: "FK_MonthlyCycles_SelectionResults_SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles",
                column: "SelectionResultId",
                principalSchema: "groups",
                principalTable: "SelectionResults",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.Sql("""
                ALTER TABLE groups."SelectionResults" ADD CONSTRAINT "FK_Selection_Actor" FOREIGN KEY ("ExecutedByUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                CREATE FUNCTION groups.reject_selection_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
                BEGIN RAISE EXCEPTION 'Completed selection history is immutable'; END;
                $body$;
                CREATE TRIGGER selection_result_immutable BEFORE UPDATE OR DELETE ON groups."SelectionResults"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_selection_history_mutation();
                CREATE TRIGGER selection_snapshot_immutable BEFORE UPDATE OR DELETE ON groups."SelectionEligibleMembers"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_selection_history_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MonthlyCycles_SelectionResults_SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropTable(
                name: "SelectionEligibleMembers",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "SelectionResults",
                schema: "groups");

            migrationBuilder.DropIndex(
                name: "IX_MonthlyCycles_SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_GroupMemberships_Id_UserId_GroupId",
                schema: "groups",
                table: "GroupMemberships");

            migrationBuilder.DropColumn(
                name: "SelectionCompletedAt",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "SelectionResultId",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropColumn(
                name: "AlgorithmVersion",
                schema: "groups",
                table: "GroupAuditEvents");

            migrationBuilder.DropColumn(
                name: "CycleId",
                schema: "groups",
                table: "GroupAuditEvents");

            migrationBuilder.DropColumn(
                name: "SelectionResultId",
                schema: "groups",
                table: "GroupAuditEvents");

            migrationBuilder.DropColumn(
                name: "WinnerMembershipId",
                schema: "groups",
                table: "GroupAuditEvents");

            migrationBuilder.RenameColumn(
                name: "HasBeenSelectedForPayout",
                schema: "groups",
                table: "GroupMemberships",
                newName: "HasReceivedPayout");
            migrationBuilder.Sql("DROP FUNCTION groups.reject_selection_history_mutation();");
        }
    }
}
