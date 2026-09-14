using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DevelopmentGroupMemberRange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Cycle_Expected",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Group_Rules",
                schema: "groups",
                table: "Groups");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Auction_Rules",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AuctionResult_Money",
                schema: "groups",
                table: "AuctionResults");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Cycle_Expected",
                schema: "groups",
                table: "MonthlyCycles",
                sql: "\"CycleNumber\" BETWEEN 1 AND \"ExpectedMemberCount\" AND \"ExpectedMemberCount\" BETWEEN 2 AND 50 AND \"ExpectedContributionPerMember\" > 0 AND \"ExpectedPoolAmount\" = \"ExpectedContributionPerMember\" * \"ExpectedMemberCount\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Group_Rules",
                schema: "groups",
                table: "Groups",
                sql: "(\"Rules\"->>'MemberLimit')::int BETWEEN 2 AND 50 AND (\"Rules\"->>'GroupValue')::numeric > 0 AND \"DurationMonths\" = (\"Rules\"->>'MemberLimit')::int AND \"MonthlyContribution\" * \"DurationMonths\" = (\"Rules\"->>'GroupValue')::numeric");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Auction_Rules",
                schema: "groups",
                table: "Auctions",
                sql: "\"GroupValue\" > 0 AND \"MemberLimit\" BETWEEN 2 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"MinimumDiscount\" >= 0 AND \"MaximumDiscount\" >= \"MinimumDiscount\" AND \"MaximumDiscount\" > 0 AND \"MaximumDiscount\" < \"GroupValue\" AND \"BidIncrement\" > 0 AND \"StartsAt\" < \"EndsAt\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AuctionResult_Money",
                schema: "groups",
                table: "AuctionResults",
                sql: "\"WinningDiscount\" > 0 AND \"WinnerPayout\" > 0 AND \"WinnerPayout\" < \"GroupValue\" AND \"WinnerPayout\" + \"WinningDiscount\" = \"GroupValue\" AND \"MemberLimit\" BETWEEN 2 AND 50 AND \"GrossMemberShare\" > 0 AND \"PlatformFee\" = \"GrossMemberShare\" AND \"GrossMemberShare\" * \"MemberLimit\" = \"WinningDiscount\" AND \"MemberBenefitPool\" + \"PlatformFee\" = \"WinningDiscount\" AND \"MemberBenefitPool\" = \"GrossMemberShare\" * (\"MemberLimit\" - 1)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Cycle_Expected",
                schema: "groups",
                table: "MonthlyCycles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Group_Rules",
                schema: "groups",
                table: "Groups");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Auction_Rules",
                schema: "groups",
                table: "Auctions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_AuctionResult_Money",
                schema: "groups",
                table: "AuctionResults");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Cycle_Expected",
                schema: "groups",
                table: "MonthlyCycles",
                sql: "\"CycleNumber\" BETWEEN 1 AND \"ExpectedMemberCount\" AND \"ExpectedMemberCount\" BETWEEN 20 AND 50 AND \"ExpectedContributionPerMember\" > 0 AND \"ExpectedPoolAmount\" = \"ExpectedContributionPerMember\" * \"ExpectedMemberCount\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Group_Rules",
                schema: "groups",
                table: "Groups",
                sql: "(\"Rules\"->>'MemberLimit')::int BETWEEN 20 AND 50 AND (\"Rules\"->>'GroupValue')::numeric > 0 AND \"DurationMonths\" = (\"Rules\"->>'MemberLimit')::int AND \"MonthlyContribution\" * \"DurationMonths\" = (\"Rules\"->>'GroupValue')::numeric");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Auction_Rules",
                schema: "groups",
                table: "Auctions",
                sql: "\"GroupValue\" > 0 AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"MinimumDiscount\" >= 0 AND \"MaximumDiscount\" >= \"MinimumDiscount\" AND \"MaximumDiscount\" > 0 AND \"MaximumDiscount\" < \"GroupValue\" AND \"BidIncrement\" > 0 AND \"StartsAt\" < \"EndsAt\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_AuctionResult_Money",
                schema: "groups",
                table: "AuctionResults",
                sql: "\"WinningDiscount\" > 0 AND \"WinnerPayout\" > 0 AND \"WinnerPayout\" < \"GroupValue\" AND \"WinnerPayout\" + \"WinningDiscount\" = \"GroupValue\" AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"GrossMemberShare\" > 0 AND \"PlatformFee\" = \"GrossMemberShare\" AND \"GrossMemberShare\" * \"MemberLimit\" = \"WinningDiscount\" AND \"MemberBenefitPool\" + \"PlatformFee\" = \"WinningDiscount\" AND \"MemberBenefitPool\" = \"GrossMemberShare\" * (\"MemberLimit\" - 1)");
        }
    }
}
