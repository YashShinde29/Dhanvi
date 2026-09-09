using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Auctions.Infrastructure;

// Auction-owned mappings participate in the existing groups transaction and migration boundary.
public static class AuctionPersistence
{
    public static void Configure(ModelBuilder model)
    {
        var a = model.Entity<Auction>(); a.ToTable("Auctions", t => {
            t.HasCheckConstraint("CK_Auction_Rules", "\"GroupValue\" > 0 AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"MinimumDiscount\" >= 0 AND \"MaximumDiscount\" >= \"MinimumDiscount\" AND \"MaximumDiscount\" > 0 AND \"MaximumDiscount\" < \"GroupValue\" AND \"BidIncrement\" > 0 AND \"StartsAt\" < \"EndsAt\"");
            t.HasCheckConstraint("CK_Auction_Current", "\"LastBidSequence\" >= 0 AND \"CurrentHighestDiscount\" >= 0 AND \"CurrentHighestDiscount\" <= \"MaximumDiscount\"");
        });
        a.HasKey(x => x.Id); a.HasAlternateKey(x => new { x.Id, x.GroupId, x.CycleId }); a.HasIndex(x => x.CycleId).IsUnique(); a.Property(x => x.Version).IsConcurrencyToken();
        a.Property(x => x.Status).HasConversion<string>(); a.Property(x => x.FeePolicy).HasConversion<string>();
        a.HasOne<MonthlyCycle>().WithMany().HasForeignKey(x => new { x.CycleId, x.GroupId }).HasPrincipalKey(c => new { c.Id, c.GroupId }).OnDelete(DeleteBehavior.Restrict);
        var b = model.Entity<AuctionBid>(); b.ToTable("AuctionBids", t => t.HasCheckConstraint("CK_AuctionBid_AmountSequence", "\"DiscountAmount\" > 0 AND \"SequenceNumber\" > 0"));
        b.HasKey(x => x.Id); b.HasAlternateKey(x => new { x.Id, x.AuctionId, x.MembershipId }); b.HasIndex(x => new { x.AuctionId, x.SequenceNumber }).IsUnique();
        b.Property(x => x.IdempotencyKey).HasMaxLength(128); b.HasIndex(x => new { x.AuctionId, x.MembershipId, x.IdempotencyKey }).IsUnique();
        b.HasOne<Auction>().WithMany().HasForeignKey(x => new { x.AuctionId, x.GroupId, x.CycleId }).HasPrincipalKey(x => new { x.Id, x.GroupId, x.CycleId }).OnDelete(DeleteBehavior.Restrict);
        b.HasOne<GroupMembership>().WithMany().HasForeignKey(x => new { x.MembershipId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        a.HasOne<AuctionBid>().WithMany().HasForeignKey(x => new { x.CurrentWinningBidId, x.Id, x.CurrentWinningMembershipId }).HasPrincipalKey(x => new { x.Id, x.AuctionId, x.MembershipId }).OnDelete(DeleteBehavior.Restrict);
        var r = model.Entity<AuctionResult>(); r.ToTable("AuctionResults", t => {
            t.HasCheckConstraint("CK_AuctionResult_Money", "\"WinningDiscount\" > 0 AND \"WinnerPayout\" > 0 AND \"WinnerPayout\" < \"GroupValue\" AND \"WinnerPayout\" + \"WinningDiscount\" = \"GroupValue\" AND \"MemberLimit\" BETWEEN 20 AND 50 AND \"GrossMemberShare\" > 0 AND \"PlatformFee\" = \"GrossMemberShare\" AND \"GrossMemberShare\" * \"MemberLimit\" = \"WinningDiscount\" AND \"MemberBenefitPool\" + \"PlatformFee\" = \"WinningDiscount\" AND \"MemberBenefitPool\" = \"GrossMemberShare\" * (\"MemberLimit\" - 1)");
            t.HasCheckConstraint("CK_AuctionResult_Version", "\"CalculationVersion\" = 'DHANVI_AUCTION_V1' AND \"FeePolicy\" = 'WinnerMemberShare'");
        });
        r.HasKey(x => x.Id); r.HasAlternateKey(x => new { x.Id, x.GroupId }); r.HasIndex(x => x.AuctionId).IsUnique(); r.HasIndex(x => x.CycleId).IsUnique(); r.HasIndex(x => x.SelectionResultId).IsUnique();
        r.Property(x => x.FeePolicy).HasConversion<string>(); r.Property(x => x.CalculationVersion).HasMaxLength(80);
        r.HasOne<Auction>().WithMany().HasForeignKey(x => new { x.AuctionId, x.GroupId, x.CycleId }).HasPrincipalKey(x => new { x.Id, x.GroupId, x.CycleId }).OnDelete(DeleteBehavior.Restrict);
        r.HasOne<AuctionBid>().WithMany().HasForeignKey(x => new { x.WinningBidId, x.AuctionId, x.WinnerMembershipId }).HasPrincipalKey(x => new { x.Id, x.AuctionId, x.MembershipId }).OnDelete(DeleteBehavior.Restrict);
        r.HasOne<SelectionResult>().WithMany().HasForeignKey(x => new { x.SelectionResultId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        r.HasMany(x => x.Allocations).WithOne().HasForeignKey(x => new { x.AuctionResultId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        r.Navigation(x => x.Allocations).UsePropertyAccessMode(PropertyAccessMode.Field);
        var allocation = model.Entity<AuctionBenefitAllocation>(); allocation.ToTable("AuctionBenefitAllocations", t => {
            t.HasCheckConstraint("CK_AuctionAllocation_Amount", "\"Amount\" >= 0");
            t.HasCheckConstraint("CK_AuctionAllocation_Recipient", "(\"AllocationType\" = 'MemberBenefit' AND \"MembershipId\" IS NOT NULL) OR (\"AllocationType\" = 'PlatformFee' AND \"MembershipId\" IS NULL)");
        });
        allocation.HasKey(x => x.Id); allocation.Property(x => x.AllocationType).HasConversion<string>();
        allocation.HasIndex(x => new { x.AuctionResultId, x.MembershipId }).IsUnique().HasFilter("\"MembershipId\" IS NOT NULL");
        allocation.HasIndex(x => x.AuctionResultId).IsUnique().HasFilter("\"AllocationType\" = 'PlatformFee'");
        allocation.HasOne<GroupMembership>().WithMany().HasForeignKey(x => new { x.MembershipId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        foreach (var entity in new[] { a.Metadata, b.Metadata, r.Metadata, allocation.Metadata })
            foreach (var property in entity.GetProperties().Where(p => p.ClrType == typeof(decimal))) { property.SetPrecision(18); property.SetScale(2); }
    }
}
