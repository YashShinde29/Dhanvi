using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.Modules.RandomDraws.Domain;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Persistence;
internal static class SelectionPersistence
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<GroupMembership>().Ignore(m => m.HasReceivedPayout);
        model.Entity<GroupMembership>().HasAlternateKey(m => new { m.Id, m.UserId, m.GroupId });
        model.Entity<GroupAuditEvent>().Property(a => a.AlgorithmVersion).HasMaxLength(80);
        var result = model.Entity<SelectionResult>(); result.ToTable("SelectionResults", t => {
            t.HasCheckConstraint("CK_Selection_Count", "\"EligibleMemberCount\" BETWEEN 1 AND 50 AND \"CycleNumber\" BETWEEN 1 AND 50 AND \"WinnerSlotNumber\" BETWEEN 1 AND 50");
            t.HasCheckConstraint("CK_Selection_Method", "(\"SelectionMethod\" = 'Random' AND \"SelectedIndex\" IS NOT NULL AND \"SelectedIndex\" >= 0 AND \"SelectedIndex\" < \"EligibleMemberCount\" AND \"SeedReveal\" IS NOT NULL AND \"SeedCommitment\" IS NOT NULL AND \"EligibleSetHash\" IS NOT NULL) OR (\"SelectionMethod\" = 'OrganizerReserved' AND \"CycleNumber\" = 1 AND \"EligibleMemberCount\" = 1 AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL) OR (\"SelectionMethod\" = 'Auction' AND \"SelectedIndex\" IS NULL AND \"SeedReveal\" IS NULL AND \"SeedCommitment\" IS NULL AND \"EligibleSetHash\" IS NULL AND \"AlgorithmVersion\" = 'DHANVI_AUCTION_V1')");
        });
        result.HasKey(r => r.Id); result.HasAlternateKey(r => new { r.Id, r.GroupId }); result.Property(r => r.SelectionMethod).HasConversion<string>();
        result.Property(r => r.AlgorithmVersion).HasMaxLength(80); result.Property(r => r.RandomSourceType).HasMaxLength(80);
        result.Property(r => r.SeedReveal).HasMaxLength(64); result.Property(r => r.SeedCommitment).HasMaxLength(64); result.Property(r => r.EligibleSetHash).HasMaxLength(64); result.Property(r => r.ResultHash).HasMaxLength(64);
        result.HasIndex(r => r.CycleId).IsUnique(); result.HasIndex(r => new { r.GroupId, r.CycleNumber }).IsUnique(); result.HasIndex(r => new { r.GroupId, r.WinnerMembershipId }).IsUnique();
        result.HasOne<MonthlyCycle>().WithMany().HasForeignKey(r => new { r.CycleId, r.GroupId }).HasPrincipalKey(c => new { c.Id, c.GroupId }).OnDelete(DeleteBehavior.Restrict);
        result.HasOne<GroupMembership>().WithMany().HasForeignKey(r => new { r.WinnerMembershipId, r.WinnerUserId, r.GroupId }).HasPrincipalKey(m => new { m.Id, m.UserId, m.GroupId }).OnDelete(DeleteBehavior.Restrict);
        result.HasMany(r => r.EligibleMembers).WithOne().HasForeignKey(e => new { e.SelectionResultId, e.GroupId }).HasPrincipalKey(r => new { r.Id, r.GroupId }).OnDelete(DeleteBehavior.Restrict);
        result.Navigation(r => r.EligibleMembers).UsePropertyAccessMode(PropertyAccessMode.Field);
        var snapshot = model.Entity<SelectionEligibleMember>(); snapshot.ToTable("SelectionEligibleMembers", t => t.HasCheckConstraint("CK_Eligible_Ordinal", "\"Ordinal\" BETWEEN 0 AND 49 AND \"SlotNumber\" BETWEEN 1 AND 50"));
        snapshot.HasKey(e => new { e.SelectionResultId, e.MembershipId }); snapshot.HasIndex(e => new { e.SelectionResultId, e.Ordinal }).IsUnique(); snapshot.HasIndex(e => new { e.SelectionResultId, e.SlotNumber }).IsUnique();
        snapshot.HasOne<GroupMembership>().WithMany().HasForeignKey(e => new { e.MembershipId, e.GroupId }).HasPrincipalKey(m => new { m.Id, m.GroupId }).OnDelete(DeleteBehavior.Restrict);
        model.Entity<MonthlyCycle>().HasOne<SelectionResult>().WithMany().HasForeignKey(c => c.SelectionResultId).OnDelete(DeleteBehavior.Restrict);
    }
}
