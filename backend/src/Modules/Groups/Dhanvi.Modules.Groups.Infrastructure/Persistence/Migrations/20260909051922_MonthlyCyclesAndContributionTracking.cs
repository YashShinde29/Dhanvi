using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF Core generated migration code.

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MonthlyCyclesAndContributionTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ActivatedAt",
                schema: "groups",
                table: "Groups",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentCycleNumber",
                schema: "groups",
                table: "Groups",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GroupTimeZone",
                schema: "groups",
                table: "Groups",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "Asia/Kolkata");

            migrationBuilder.AddColumn<Guid>(
                name: "SubjectId",
                schema: "groups",
                table: "GroupAuditEvents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_GroupMemberships_Id_GroupId",
                schema: "groups",
                table: "GroupMemberships",
                columns: new[] { "Id", "GroupId" });

            migrationBuilder.CreateTable(
                name: "IdempotencyRecords",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Scope = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RequestHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IdempotencyRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MonthlyCycles",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    SelectionMethod = table.Column<string>(type: "text", nullable: false),
                    ContributionDueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    SelectionDate = table.Column<DateOnly>(type: "date", nullable: false),
                    PayoutDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ExpectedMemberCount = table.Column<int>(type: "integer", nullable: false),
                    ExpectedContributionPerMember = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ExpectedPoolAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    RecordedContributionAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    FullyRecordedMemberCount = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ContributionsCompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReadyForSelectionAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MonthlyCycles", x => x.Id);
                    table.UniqueConstraint("AK_MonthlyCycles_Id_GroupId", x => new { x.Id, x.GroupId });
                    table.CheckConstraint("CK_Cycle_Dates", "\"ContributionDueDate\" <= \"SelectionDate\" AND \"SelectionDate\" <= \"PayoutDate\"");
                    table.CheckConstraint("CK_Cycle_Expected", "\"CycleNumber\" BETWEEN 1 AND \"ExpectedMemberCount\" AND \"ExpectedMemberCount\" BETWEEN 20 AND 50 AND \"ExpectedContributionPerMember\" > 0 AND \"ExpectedPoolAmount\" = \"ExpectedContributionPerMember\" * \"ExpectedMemberCount\"");
                    table.CheckConstraint("CK_Cycle_Totals", "\"RecordedContributionAmount\" BETWEEN 0 AND \"ExpectedPoolAmount\" AND \"FullyRecordedMemberCount\" BETWEEN 0 AND \"ExpectedMemberCount\"");
                    table.ForeignKey(
                        name: "FK_MonthlyCycles_Groups_GroupId",
                        column: x => x.GroupId,
                        principalSchema: "groups",
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Contributions",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpectedAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    RecordedAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    OverdueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Contributions", x => x.Id);
                    table.CheckConstraint("CK_Contribution_Amounts", "\"ExpectedAmount\" > 0 AND \"RecordedAmount\" BETWEEN 0 AND \"ExpectedAmount\"");
                    table.ForeignKey(
                        name: "FK_Contributions_GroupMemberships_MembershipId_GroupId",
                        columns: x => new { x.MembershipId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Contributions_MonthlyCycles_CycleId_GroupId",
                        columns: x => new { x.CycleId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "MonthlyCycles",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ContributionEntries",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ContributionId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntryType = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Reference = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReversesEntryId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContributionEntries", x => x.Id);
                    table.UniqueConstraint("AK_ContributionEntries_Id_ContributionId", x => new { x.Id, x.ContributionId });
                    table.CheckConstraint("CK_Entry_Amount", "\"Amount\" > 0");
                    table.CheckConstraint("CK_Entry_Reversal", "(\"EntryType\" = 'Record' AND \"ReversesEntryId\" IS NULL) OR (\"EntryType\" = 'Reversal' AND \"ReversesEntryId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_ContributionEntries_ContributionEntries_ReversesEntryId_Con~",
                        columns: x => new { x.ReversesEntryId, x.ContributionId },
                        principalSchema: "groups",
                        principalTable: "ContributionEntries",
                        principalColumns: new[] { "Id", "ContributionId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ContributionEntries_Contributions_ContributionId",
                        column: x => x.ContributionId,
                        principalSchema: "groups",
                        principalTable: "Contributions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContributionEntries_ContributionId_IdempotencyKey",
                schema: "groups",
                table: "ContributionEntries",
                columns: new[] { "ContributionId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContributionEntries_ContributionId_Reference",
                schema: "groups",
                table: "ContributionEntries",
                columns: new[] { "ContributionId", "Reference" },
                unique: true,
                filter: "\"EntryType\" = 'Record'");

            migrationBuilder.CreateIndex(
                name: "IX_ContributionEntries_Reference",
                schema: "groups",
                table: "ContributionEntries",
                column: "Reference");

            migrationBuilder.CreateIndex(
                name: "IX_ContributionEntries_ReversesEntryId",
                schema: "groups",
                table: "ContributionEntries",
                column: "ReversesEntryId",
                unique: true,
                filter: "\"ReversesEntryId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ContributionEntries_ReversesEntryId_ContributionId",
                schema: "groups",
                table: "ContributionEntries",
                columns: new[] { "ReversesEntryId", "ContributionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_CycleId_GroupId",
                schema: "groups",
                table: "Contributions",
                columns: new[] { "CycleId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_CycleId_MembershipId",
                schema: "groups",
                table: "Contributions",
                columns: new[] { "CycleId", "MembershipId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_DueDate",
                schema: "groups",
                table: "Contributions",
                column: "DueDate");

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_MembershipId",
                schema: "groups",
                table: "Contributions",
                column: "MembershipId");

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_MembershipId_GroupId",
                schema: "groups",
                table: "Contributions",
                columns: new[] { "MembershipId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_Contributions_Status_DueDate",
                schema: "groups",
                table: "Contributions",
                columns: new[] { "Status", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_IdempotencyRecords_Scope_Key",
                schema: "groups",
                table: "IdempotencyRecords",
                columns: new[] { "Scope", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MonthlyCycles_ContributionDueDate",
                schema: "groups",
                table: "MonthlyCycles",
                column: "ContributionDueDate");

            migrationBuilder.CreateIndex(
                name: "IX_MonthlyCycles_GroupId_CycleNumber",
                schema: "groups",
                table: "MonthlyCycles",
                columns: new[] { "GroupId", "CycleNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MonthlyCycles_Status",
                schema: "groups",
                table: "MonthlyCycles",
                column: "Status");
            migrationBuilder.Sql("""
                ALTER TABLE groups."ContributionEntries" ADD CONSTRAINT "FK_ContributionEntry_Actor" FOREIGN KEY ("RecordedByUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                CREATE UNIQUE INDEX "IX_MonthlyCycles_OneOpenCycle" ON groups."MonthlyCycles" ("GroupId") WHERE "Status" IN ('CollectingContributions', 'ContributionsComplete', 'ReadyForSelection');
                CREATE FUNCTION groups.reject_operational_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
                BEGIN
                    RAISE EXCEPTION 'Operational contribution history is append-only';
                END;
                $body$;
                CREATE TRIGGER contribution_entries_append_only BEFORE UPDATE OR DELETE ON groups."ContributionEntries"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_operational_history_mutation();
                CREATE TRIGGER idempotency_records_append_only BEFORE UPDATE OR DELETE ON groups."IdempotencyRecords"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_operational_history_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ContributionEntries",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "IdempotencyRecords",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "Contributions",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "MonthlyCycles",
                schema: "groups");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_GroupMemberships_Id_GroupId",
                schema: "groups",
                table: "GroupMemberships");

            migrationBuilder.DropColumn(
                name: "ActivatedAt",
                schema: "groups",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "CurrentCycleNumber",
                schema: "groups",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "GroupTimeZone",
                schema: "groups",
                table: "Groups");

            migrationBuilder.DropColumn(
                name: "SubjectId",
                schema: "groups",
                table: "GroupAuditEvents");
            migrationBuilder.Sql("DROP FUNCTION groups.reject_operational_history_mutation();");
        }
    }
}
