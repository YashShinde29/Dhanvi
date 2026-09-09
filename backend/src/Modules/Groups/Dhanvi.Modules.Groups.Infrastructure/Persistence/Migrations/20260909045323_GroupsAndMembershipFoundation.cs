using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF Core generated migration code.

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class GroupsAndMembershipFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "groups");

            migrationBuilder.CreateTable(
                name: "Groups",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: false),
                    CreatorType = table.Column<string>(type: "text", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Rules = table.Column<string>(type: "jsonb", nullable: false),
                    GroupType = table.Column<string>(type: "text", nullable: false),
                    GroupValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MemberLimit = table.Column<int>(type: "integer", nullable: false),
                    MonthlyContribution = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DurationMonths = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CurrentMemberCount = table.Column<int>(type: "integer", nullable: false),
                    RulesLocked = table.Column<bool>(type: "boolean", nullable: false),
                    RulesVersion = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PublishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    StatusReason = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Groups", x => x.Id);
                    table.CheckConstraint("CK_Group_Capacity", "\"CurrentMemberCount\" >= 0 AND \"CurrentMemberCount\" <= (\"Rules\"->>'MemberLimit')::int");
                    table.CheckConstraint("CK_Group_Rules", "(\"Rules\"->>'MemberLimit')::int BETWEEN 20 AND 50 AND (\"Rules\"->>'GroupValue')::numeric > 0 AND \"DurationMonths\" = (\"Rules\"->>'MemberLimit')::int AND \"MonthlyContribution\" * \"DurationMonths\" = (\"Rules\"->>'GroupValue')::numeric");
                });

            migrationBuilder.CreateTable(
                name: "GroupAuditEvents",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Action = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupAuditEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupAuditEvents_Groups_GroupId",
                        column: x => x.GroupId,
                        principalSchema: "groups",
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupRuleVersions",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    RulesSnapshot = table.Column<string>(type: "text", nullable: false),
                    RulesHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupRuleVersions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupRuleVersions_Groups_GroupId",
                        column: x => x.GroupId,
                        principalSchema: "groups",
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupMemberships",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SlotNumber = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    AppliedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RejectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RejectedReason = table.Column<string>(type: "text", nullable: true),
                    TermsVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    TermsAcceptedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    HasReceivedPayout = table.Column<bool>(type: "boolean", nullable: false),
                    PayoutCycleNumber = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupMemberships", x => x.Id);
                    table.CheckConstraint("CK_Membership_Slot", "\"SlotNumber\" IS NULL OR \"SlotNumber\" BETWEEN 1 AND 50");
                    table.ForeignKey(
                        name: "FK_GroupMemberships_GroupRuleVersions_TermsVersionId",
                        column: x => x.TermsVersionId,
                        principalSchema: "groups",
                        principalTable: "GroupRuleVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GroupMemberships_Groups_GroupId",
                        column: x => x.GroupId,
                        principalSchema: "groups",
                        principalTable: "Groups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GroupTermsAcceptances",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupRuleVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    AcceptedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RulesHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GroupTermsAcceptances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GroupTermsAcceptances_GroupMemberships_MembershipId",
                        column: x => x.MembershipId,
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GroupTermsAcceptances_GroupRuleVersions_GroupRuleVersionId",
                        column: x => x.GroupRuleVersionId,
                        principalSchema: "groups",
                        principalTable: "GroupRuleVersions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GroupAuditEvents_GroupId_CreatedAt",
                schema: "groups",
                table: "GroupAuditEvents",
                columns: new[] { "GroupId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_GroupId_SlotNumber",
                schema: "groups",
                table: "GroupMemberships",
                columns: new[] { "GroupId", "SlotNumber" },
                unique: true,
                filter: "\"SlotNumber\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_GroupId_UserId",
                schema: "groups",
                table: "GroupMemberships",
                columns: new[] { "GroupId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_Status",
                schema: "groups",
                table: "GroupMemberships",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_TermsVersionId",
                schema: "groups",
                table: "GroupMemberships",
                column: "TermsVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupMemberships_UserId",
                schema: "groups",
                table: "GroupMemberships",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupRuleVersions_GroupId_VersionNumber",
                schema: "groups",
                table: "GroupRuleVersions",
                columns: new[] { "GroupId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Groups_CreatedByUserId",
                schema: "groups",
                table: "Groups",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_CreatorType",
                schema: "groups",
                table: "Groups",
                column: "CreatorType");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_GroupType",
                schema: "groups",
                table: "Groups",
                column: "GroupType");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_GroupValue",
                schema: "groups",
                table: "Groups",
                column: "GroupValue");

            migrationBuilder.CreateIndex(
                name: "IX_Groups_Status",
                schema: "groups",
                table: "Groups",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTermsAcceptances_GroupRuleVersionId",
                schema: "groups",
                table: "GroupTermsAcceptances",
                column: "GroupRuleVersionId");

            migrationBuilder.CreateIndex(
                name: "IX_GroupTermsAcceptances_MembershipId_GroupRuleVersionId",
                schema: "groups",
                table: "GroupTermsAcceptances",
                columns: new[] { "MembershipId", "GroupRuleVersionId" },
                unique: true);
            // Cross-module references are database contracts, without an infrastructure dependency.
            migrationBuilder.Sql("""
                ALTER TABLE groups."Groups" ADD CONSTRAINT "FK_Groups_Creator" FOREIGN KEY ("CreatedByUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                ALTER TABLE groups."GroupMemberships" ADD CONSTRAINT "FK_Memberships_User" FOREIGN KEY ("UserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                ALTER TABLE groups."GroupRuleVersions" ADD CONSTRAINT "FK_Rules_Creator" FOREIGN KEY ("CreatedByUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                ALTER TABLE groups."GroupAuditEvents" ADD CONSTRAINT "FK_GroupAudit_Actor" FOREIGN KEY ("ActorUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GroupAuditEvents",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "GroupTermsAcceptances",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "GroupMemberships",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "GroupRuleVersions",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "Groups",
                schema: "groups");
        }
    }
}
