using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // EF Core generated migration code.

namespace Dhanvi.Modules.Organizers.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class OrganizerApplications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "organizers");

            migrationBuilder.CreateTable(
                name: "organizer_applications",
                schema: "organizers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    FullLegalName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    City = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    State = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PostalCode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReasonForBecomingOrganizer = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ExperienceDescription = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ReviewedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RejectionReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organizer_applications", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "organizer_profiles",
                schema: "organizers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ApprovedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ApprovedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    SuspendedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_organizer_profiles", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_organizer_applications_Status",
                schema: "organizers",
                table: "organizer_applications",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_organizer_applications_UserId",
                schema: "organizers",
                table: "organizer_applications",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_organizer_applications_UserId_Status",
                schema: "organizers",
                table: "organizer_applications",
                columns: new[] { "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_organizer_profiles_UserId",
                schema: "organizers",
                table: "organizer_profiles",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "organizer_applications",
                schema: "organizers");

            migrationBuilder.DropTable(
                name: "organizer_profiles",
                schema: "organizers");
        }
    }
}
