using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
#pragma warning disable CA1861 // Preserve EF-generated migration array literals.

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AuctionEngine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Selection_Method",
                schema: "groups",
                table: "SelectionResults");

            migrationBuilder.CreateTable(
                name: "AuctionBenefitAllocations",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AuctionResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: true),
                    AllocationType = table.Column<string>(type: "text", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuctionBenefitAllocations", x => x.Id);
                    table.CheckConstraint("CK_AuctionAllocation_Amount", "\"Amount\" >= 0");
                    table.CheckConstraint("CK_AuctionAllocation_Recipient", "(\"AllocationType\" = 'MemberBenefit' AND \"MembershipId\" IS NOT NULL) OR (\"AllocationType\" = 'PlatformFee' AND \"MembershipId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_AuctionBenefitAllocations_GroupMemberships_MembershipId_Gro~",
                        columns: x => new { x.MembershipId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AuctionBids",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AuctionId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    SequenceNumber = table.Column<long>(type: "bigint", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    SubmittedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuctionBids", x => x.Id);
                    table.UniqueConstraint("AK_AuctionBids_Id_AuctionId_MembershipId", x => new { x.Id, x.AuctionId, x.MembershipId });
                    table.CheckConstraint("CK_AuctionBid_AmountSequence", "\"DiscountAmount\" > 0 AND \"SequenceNumber\" > 0");
                    table.ForeignKey(
                        name: "FK_AuctionBids_GroupMemberships_MembershipId_GroupId",
                        columns: x => new { x.MembershipId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "GroupMemberships",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Auctions",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleNumber = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    StartsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndsAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    GroupValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MemberLimit = table.Column<int>(type: "integer", nullable: false),
                    MinimumDiscount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MaximumDiscount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    BidIncrement = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    FeePolicy = table.Column<string>(type: "text", nullable: false),
                    CurrentHighestDiscount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrentWinningBidId = table.Column<Guid>(type: "uuid", nullable: true),
                    CurrentWinningMembershipId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastBidSequence = table.Column<long>(type: "bigint", nullable: false),
                    OpenedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    WinnerSelectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Auctions", x => x.Id);
                    table.UniqueConstraint("AK_Auctions_Id_GroupId_CycleId", x => new { x.Id, x.GroupId, x.CycleId });
                    table.CheckConstraint("CK_Auction_Current", "\"LastBidSequence\" >= 0 AND \"CurrentHighestDiscount\" >= 0 AND \"CurrentHighestDiscount\" <= \"MaximumDiscount\"");
                    table.CheckConstraint("CK_Auction_Rules", "\"GroupValue\" > 0 AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"MinimumDiscount\" >= 0 AND \"MaximumDiscount\" >= \"MinimumDiscount\" AND \"MaximumDiscount\" > 0 AND \"MaximumDiscount\" < \"GroupValue\" AND \"BidIncrement\" > 0 AND \"StartsAt\" < \"EndsAt\"");
                    table.ForeignKey(
                        name: "FK_Auctions_AuctionBids_CurrentWinningBidId_Id_CurrentWinningM~",
                        columns: x => new { x.CurrentWinningBidId, x.Id, x.CurrentWinningMembershipId },
                        principalSchema: "groups",
                        principalTable: "AuctionBids",
                        principalColumns: new[] { "Id", "AuctionId", "MembershipId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Auctions_MonthlyCycles_CycleId_GroupId",
                        columns: x => new { x.CycleId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "MonthlyCycles",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AuctionResults",
                schema: "groups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AuctionId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupId = table.Column<Guid>(type: "uuid", nullable: false),
                    CycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    SelectionResultId = table.Column<Guid>(type: "uuid", nullable: false),
                    WinningBidId = table.Column<Guid>(type: "uuid", nullable: false),
                    WinnerMembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    GroupValue = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MemberLimit = table.Column<int>(type: "integer", nullable: false),
                    WinningDiscount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    WinnerPayout = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GrossMemberShare = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PlatformFee = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    MemberBenefitPool = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    FeePolicy = table.Column<string>(type: "text", nullable: false),
                    CalculationVersion = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    FinalizedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinalizedByUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuctionResults", x => x.Id);
                    table.UniqueConstraint("AK_AuctionResults_Id_GroupId", x => new { x.Id, x.GroupId });
                    table.CheckConstraint("CK_AuctionResult_Money", "\"WinningDiscount\" > 0 AND \"WinnerPayout\" > 0 AND \"WinnerPayout\" < \"GroupValue\" AND \"WinnerPayout\" + \"WinningDiscount\" = \"GroupValue\" AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"GrossMemberShare\" > 0 AND \"PlatformFee\" = \"GrossMemberShare\" AND \"GrossMemberShare\" * \"MemberLimit\" = \"WinningDiscount\" AND \"MemberBenefitPool\" + \"PlatformFee\" = \"WinningDiscount\" AND \"MemberBenefitPool\" = \"GrossMemberShare\" * (\"MemberLimit\" - 1)");
                    table.CheckConstraint("CK_AuctionResult_Version", "\"CalculationVersion\" = 'DHANVI_AUCTION_V1' AND \"FeePolicy\" = 'WinnerMemberShare'");
                    table.ForeignKey(
                        name: "FK_AuctionResults_AuctionBids_WinningBidId_AuctionId_WinnerMem~",
                        columns: x => new { x.WinningBidId, x.AuctionId, x.WinnerMembershipId },
                        principalSchema: "groups",
                        principalTable: "AuctionBids",
                        principalColumns: new[] { "Id", "AuctionId", "MembershipId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AuctionResults_Auctions_AuctionId_GroupId_CycleId",
                        columns: x => new { x.AuctionId, x.GroupId, x.CycleId },
                        principalSchema: "groups",
                        principalTable: "Auctions",
                        principalColumns: new[] { "Id", "GroupId", "CycleId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AuctionResults_SelectionResults_SelectionResultId_GroupId",
                        columns: x => new { x.SelectionResultId, x.GroupId },
                        principalSchema: "groups",
                        principalTable: "SelectionResults",
                        principalColumns: new[] { "Id", "GroupId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Selection_Method",
                schema: "groups",
                table: "SelectionResults",
                sql: "(\"SelectionMethod\" = 'Random' AND \"SelectedIndex\" IS NOT NULL AND \"SelectedIndex\" >= 0 AND \"SelectedIndex\" < \"EligibleMemberCount\" AND \"SeedReveal\" IS NOT NULL AND \"SeedCommitment\" IS NOT NULL AND \"EligibleSetHash\" IS NOT NULL) OR (\"SelectionMethod\" = 'OrganizerReserved' AND \"CycleNumber\" = 1 AND \"EligibleMemberCount\" = 1 AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL) OR (\"SelectionMethod\" = 'Auction' AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL AND \"AlgorithmVersion\" = 'DHANVI_AUCTION_V1')");

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBenefitAllocations_AuctionResultId",
                schema: "groups",
                table: "AuctionBenefitAllocations",
                column: "AuctionResultId",
                unique: true,
                filter: "\"AllocationType\" = 'PlatformFee'");

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBenefitAllocations_AuctionResultId_GroupId",
                schema: "groups",
                table: "AuctionBenefitAllocations",
                columns: new[] { "AuctionResultId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBenefitAllocations_AuctionResultId_MembershipId",
                schema: "groups",
                table: "AuctionBenefitAllocations",
                columns: new[] { "AuctionResultId", "MembershipId" },
                unique: true,
                filter: "\"MembershipId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBenefitAllocations_MembershipId_GroupId",
                schema: "groups",
                table: "AuctionBenefitAllocations",
                columns: new[] { "MembershipId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBids_AuctionId_GroupId_CycleId",
                schema: "groups",
                table: "AuctionBids",
                columns: new[] { "AuctionId", "GroupId", "CycleId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBids_AuctionId_MembershipId_IdempotencyKey",
                schema: "groups",
                table: "AuctionBids",
                columns: new[] { "AuctionId", "MembershipId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBids_AuctionId_SequenceNumber",
                schema: "groups",
                table: "AuctionBids",
                columns: new[] { "AuctionId", "SequenceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionBids_MembershipId_GroupId",
                schema: "groups",
                table: "AuctionBids",
                columns: new[] { "MembershipId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_AuctionId",
                schema: "groups",
                table: "AuctionResults",
                column: "AuctionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_AuctionId_GroupId_CycleId",
                schema: "groups",
                table: "AuctionResults",
                columns: new[] { "AuctionId", "GroupId", "CycleId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_CycleId",
                schema: "groups",
                table: "AuctionResults",
                column: "CycleId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_SelectionResultId",
                schema: "groups",
                table: "AuctionResults",
                column: "SelectionResultId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_SelectionResultId_GroupId",
                schema: "groups",
                table: "AuctionResults",
                columns: new[] { "SelectionResultId", "GroupId" });

            migrationBuilder.CreateIndex(
                name: "IX_AuctionResults_WinningBidId_AuctionId_WinnerMembershipId",
                schema: "groups",
                table: "AuctionResults",
                columns: new[] { "WinningBidId", "AuctionId", "WinnerMembershipId" });

            migrationBuilder.CreateIndex(
                name: "IX_Auctions_CurrentWinningBidId_Id_CurrentWinningMembershipId",
                schema: "groups",
                table: "Auctions",
                columns: new[] { "CurrentWinningBidId", "Id", "CurrentWinningMembershipId" });

            migrationBuilder.CreateIndex(
                name: "IX_Auctions_CycleId",
                schema: "groups",
                table: "Auctions",
                column: "CycleId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Auctions_CycleId_GroupId",
                schema: "groups",
                table: "Auctions",
                columns: new[] { "CycleId", "GroupId" });

            migrationBuilder.AddForeignKey(
                name: "FK_AuctionBenefitAllocations_AuctionResults_AuctionResultId_Gr~",
                schema: "groups",
                table: "AuctionBenefitAllocations",
                columns: new[] { "AuctionResultId", "GroupId" },
                principalSchema: "groups",
                principalTable: "AuctionResults",
                principalColumns: new[] { "Id", "GroupId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_AuctionBids_Auctions_AuctionId_GroupId_CycleId",
                schema: "groups",
                table: "AuctionBids",
                columns: new[] { "AuctionId", "GroupId", "CycleId" },
                principalSchema: "groups",
                principalTable: "Auctions",
                principalColumns: new[] { "Id", "GroupId", "CycleId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql("""
                ALTER TABLE groups."AuctionResults" ADD CONSTRAINT "FK_AuctionResult_Actor"
                    FOREIGN KEY ("FinalizedByUserId") REFERENCES identity.users ("Id") ON DELETE RESTRICT;
                CREATE FUNCTION groups.reject_auction_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
                BEGIN RAISE EXCEPTION 'Auction history is immutable'; END;
                $body$;
                CREATE TRIGGER auction_bid_immutable BEFORE UPDATE OR DELETE ON groups."AuctionBids"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();
                CREATE TRIGGER auction_result_immutable BEFORE UPDATE OR DELETE ON groups."AuctionResults"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();
                CREATE TRIGGER auction_allocation_immutable BEFORE UPDATE OR DELETE ON groups."AuctionBenefitAllocations"
                    FOR EACH ROW EXECUTE FUNCTION groups.reject_auction_history_mutation();

                CREATE FUNCTION groups.guard_auction_bid_insert() RETURNS trigger LANGUAGE plpgsql AS $body$
                DECLARE auction_status text;
                BEGIN
                    SELECT "Status" INTO auction_status FROM groups."Auctions" WHERE "Id" = NEW."AuctionId" FOR UPDATE;
                    IF auction_status IS DISTINCT FROM 'Open' THEN RAISE EXCEPTION 'Auction is not open'; END IF;
                    RETURN NEW;
                END;
                $body$;
                CREATE TRIGGER auction_bid_open BEFORE INSERT ON groups."AuctionBids"
                    FOR EACH ROW EXECUTE FUNCTION groups.guard_auction_bid_insert();

                CREATE FUNCTION groups.guard_auction_terminal_state() RETURNS trigger LANGUAGE plpgsql AS $body$
                BEGIN
                    IF OLD."Status" IN ('Closed', 'WinnerSelected', 'ClosedNoBids') THEN
                        RAISE EXCEPTION 'Closed auction is immutable';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $body$;
                CREATE TRIGGER auction_terminal_immutable BEFORE UPDATE OR DELETE ON groups."Auctions"
                    FOR EACH ROW EXECUTE FUNCTION groups.guard_auction_terminal_state();

                CREATE FUNCTION groups.check_auction_allocation_total() RETURNS trigger LANGUAGE plpgsql AS $body$
                DECLARE result_id uuid; result_row groups."AuctionResults"%ROWTYPE; allocation_count bigint; total numeric;
                BEGIN
                    IF TG_TABLE_NAME = 'AuctionResults' THEN result_id := NEW."Id";
                    ELSE result_id := NEW."AuctionResultId"; END IF;
                    SELECT * INTO STRICT result_row FROM groups."AuctionResults" WHERE "Id" = result_id;
                    SELECT count(*), COALESCE(sum("Amount"), 0) INTO allocation_count, total
                        FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id;
                    IF allocation_count <> result_row."MemberLimit" OR total <> result_row."WinningDiscount"
                        OR (SELECT count(*) FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id AND "AllocationType" = 'PlatformFee') <> 1
                        OR (SELECT count(*) FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id AND "AllocationType" = 'MemberBenefit') <> result_row."MemberLimit" - 1
                        OR EXISTS (SELECT 1 FROM groups."AuctionBenefitAllocations" a WHERE a."AuctionResultId" = result_id
                            AND a."MembershipId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM groups."Contributions" c
                                WHERE c."CycleId" = result_row."CycleId" AND c."MembershipId" = a."MembershipId"))
                        OR EXISTS (SELECT 1 FROM groups."AuctionBenefitAllocations" WHERE "AuctionResultId" = result_id
                            AND ("Amount" <> result_row."GrossMemberShare" OR "MembershipId" = result_row."WinnerMembershipId"))
                    THEN RAISE EXCEPTION 'Auction allocations must exactly conserve the discount'; END IF;
                    RETURN NEW;
                END;
                $body$;
                CREATE CONSTRAINT TRIGGER auction_result_allocations AFTER INSERT ON groups."AuctionResults"
                    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION groups.check_auction_allocation_total();
                CREATE CONSTRAINT TRIGGER auction_allocation_total AFTER INSERT ON groups."AuctionBenefitAllocations"
                    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION groups.check_auction_allocation_total();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_AuctionBids_Auctions_AuctionId_GroupId_CycleId",
                schema: "groups",
                table: "AuctionBids");

            migrationBuilder.DropTable(
                name: "AuctionBenefitAllocations",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "AuctionResults",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "Auctions",
                schema: "groups");

            migrationBuilder.DropTable(
                name: "AuctionBids",
                schema: "groups");

            migrationBuilder.Sql("""
                DROP FUNCTION groups.check_auction_allocation_total();
                DROP FUNCTION groups.guard_auction_terminal_state();
                DROP FUNCTION groups.guard_auction_bid_insert();
                DROP FUNCTION groups.reject_auction_history_mutation();
                """);
            migrationBuilder.DropCheckConstraint(
                name: "CK_Selection_Method",
                schema: "groups",
                table: "SelectionResults");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Selection_Method",
                schema: "groups",
                table: "SelectionResults",
                sql: "(\"SelectionMethod\" = 'Random' AND \"SelectedIndex\" IS NOT NULL AND \"SelectedIndex\" >= 0 AND \"SelectedIndex\" < \"EligibleMemberCount\" AND \"SeedReveal\" IS NOT NULL AND \"SeedCommitment\" IS NOT NULL AND \"EligibleSetHash\" IS NOT NULL) OR (\"SelectionMethod\" = 'OrganizerReserved' AND \"CycleNumber\" = 1 AND \"EligibleMemberCount\" = 1 AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL)");
        }
    }
}
