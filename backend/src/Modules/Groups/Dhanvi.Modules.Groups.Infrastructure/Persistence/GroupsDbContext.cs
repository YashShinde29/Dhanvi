using System.Text.Json;
using Dhanvi.Modules.Auctions.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.SharedKernel.Domain;
using Dhanvi.Modules.Groups.Domain;
using Microsoft.EntityFrameworkCore;

namespace Dhanvi.Modules.Groups.Infrastructure.Persistence;

public sealed class GroupsDbContext(DbContextOptions<GroupsDbContext> options) : DbContext(options)
{
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<GroupMembership> Memberships => Set<GroupMembership>();
    public DbSet<GroupRuleVersion> RuleVersions => Set<GroupRuleVersion>();
    public DbSet<GroupTermsAcceptance> TermsAcceptances => Set<GroupTermsAcceptance>();
    public DbSet<GroupAuditEvent> AuditEvents => Set<GroupAuditEvent>();
    public DbSet<MonthlyCycle> MonthlyCycles => Set<MonthlyCycle>();
    public DbSet<Contribution> Contributions => Set<Contribution>();
    public DbSet<ContributionEntry> ContributionEntries => Set<ContributionEntry>();
    public DbSet<IdempotencyRecord> IdempotencyRecords => Set<IdempotencyRecord>();
    public DbSet<SelectionResult> SelectionResults => Set<SelectionResult>();
    public DbSet<SelectionEligibleMember> SelectionEligibleMembers => Set<SelectionEligibleMember>();
    public DbSet<Auction> Auctions => Set<Auction>();
    public DbSet<AuctionBid> AuctionBids => Set<AuctionBid>();
    public DbSet<AuctionResult> AuctionResults => Set<AuctionResult>();
    public DbSet<AuctionBenefitAllocation> AuctionBenefitAllocations => Set<AuctionBenefitAllocation>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("groups");
        CyclePersistence.Configure(modelBuilder);
        SelectionPersistence.Configure(modelBuilder);
        Dhanvi.Modules.Auctions.Infrastructure.AuctionPersistence.Configure(modelBuilder);
        var g = modelBuilder.Entity<Group>();
        g.ToTable("Groups", t => {
            t.HasCheckConstraint("CK_Group_Capacity", "\"CurrentMemberCount\" >= 0 AND \"CurrentMemberCount\" <= (\"Rules\"->>'MemberLimit')::int");
            t.HasCheckConstraint("CK_Group_Rules", "(\"Rules\"->>'MemberLimit')::int BETWEEN 20 AND 50 AND (\"Rules\"->>'GroupValue')::numeric > 0 AND \"DurationMonths\" = (\"Rules\"->>'MemberLimit')::int AND \"MonthlyContribution\" * \"DurationMonths\" = (\"Rules\"->>'GroupValue')::numeric");
        });
        g.HasKey(x => x.Id); g.Property(x => x.Name).HasMaxLength(200); g.Property(x => x.Description).HasMaxLength(4000);
        g.Property(x => x.Rules).HasConversion(v => JsonSerializer.Serialize(v, (JsonSerializerOptions?)null), v => JsonSerializer.Deserialize<GroupConfiguration>(v, (JsonSerializerOptions?)null)!).HasColumnType("jsonb");
        g.Property(x => x.MonthlyContribution).HasPrecision(18, 2); g.Property(x => x.Version).IsConcurrencyToken();
        g.Property(x => x.Status).HasConversion<string>(); g.Property(x => x.CreatorType).HasConversion<string>();
        g.Ignore(x => x.FirstCycleSelectionMethod);
        g.Property(x => x.GroupValue).HasPrecision(18, 2); g.Property(x => x.GroupType).HasConversion<string>();
        g.HasIndex(x => x.GroupValue); g.HasIndex(x => x.GroupType);
        g.HasIndex(x => x.Status); g.HasIndex(x => x.CreatorType); g.HasIndex(x => x.CreatedByUserId);
        var m = modelBuilder.Entity<GroupMembership>(); m.ToTable("GroupMemberships", t => t.HasCheckConstraint("CK_Membership_Slot", "\"SlotNumber\" IS NULL OR \"SlotNumber\" BETWEEN 1 AND 50"));
        m.HasKey(x => x.Id); m.Property(x => x.Status).HasConversion<string>();
        m.HasIndex(x => new { x.GroupId, x.UserId }).IsUnique(); m.HasIndex(x => new { x.GroupId, x.SlotNumber }).IsUnique().HasFilter("\"SlotNumber\" IS NOT NULL");
        m.HasIndex(x => x.UserId); m.HasIndex(x => x.Status);
        m.HasOne<Group>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
        m.HasOne<GroupRuleVersion>().WithMany().HasForeignKey(x => x.TermsVersionId).OnDelete(DeleteBehavior.Restrict);
        var r = modelBuilder.Entity<GroupRuleVersion>(); r.ToTable("GroupRuleVersions"); r.HasKey(x => x.Id);
        r.HasIndex(x => new { x.GroupId, x.VersionNumber }).IsUnique(); r.Property(x => x.RulesHash).HasMaxLength(64);
        r.HasOne<Group>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
        var a = modelBuilder.Entity<GroupTermsAcceptance>(); a.ToTable("GroupTermsAcceptances"); a.HasKey(x => x.Id);
        a.HasIndex(x => new { x.MembershipId, x.GroupRuleVersionId }).IsUnique(); a.Property(x => x.RulesHash).HasMaxLength(64);
        a.HasOne<GroupMembership>().WithMany().HasForeignKey(x => x.MembershipId).OnDelete(DeleteBehavior.Restrict);
        a.HasOne<GroupRuleVersion>().WithMany().HasForeignKey(x => x.GroupRuleVersionId).OnDelete(DeleteBehavior.Restrict);
        var e = modelBuilder.Entity<GroupAuditEvent>(); e.ToTable("GroupAuditEvents"); e.HasKey(x => x.Id); e.HasIndex(x => new { x.GroupId, x.CreatedAt });
        e.HasOne<Group>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
    }
}
