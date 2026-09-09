using Dhanvi.Modules.Contributions.Domain;
using Dhanvi.Modules.Cycles.Domain;
using Dhanvi.Modules.Groups.Domain;
using Dhanvi.SharedKernel.Domain;
using Dhanvi.SharedKernel.Time;
using Microsoft.EntityFrameworkCore;
namespace Dhanvi.Modules.Groups.Infrastructure.Persistence;

internal static class CyclePersistence
{
    public static void Configure(ModelBuilder model)
    {
        model.Entity<Group>().Property(x => x.GroupTimeZone).HasMaxLength(100).HasDefaultValue(BusinessCalendar.DefaultTimeZone);
        var c = model.Entity<MonthlyCycle>();
        c.ToTable("MonthlyCycles", t => {
            t.HasCheckConstraint("CK_Cycle_Expected", "\"CycleNumber\" BETWEEN 1 AND \"ExpectedMemberCount\" AND \"ExpectedMemberCount\" BETWEEN 20 AND 50 AND \"ExpectedContributionPerMember\" > 0 AND \"ExpectedPoolAmount\" = \"ExpectedContributionPerMember\" * \"ExpectedMemberCount\"");
            t.HasCheckConstraint("CK_Cycle_Totals", "\"RecordedContributionAmount\" BETWEEN 0 AND \"ExpectedPoolAmount\" AND \"FullyRecordedMemberCount\" BETWEEN 0 AND \"ExpectedMemberCount\"");
            t.HasCheckConstraint("CK_Cycle_Dates", "\"ContributionDueDate\" <= \"SelectionDate\" AND \"SelectionDate\" <= \"PayoutDate\"");
        });
        c.HasKey(x => x.Id); c.HasAlternateKey(x => new { x.Id, x.GroupId });
        c.Property(x => x.Status).HasConversion<string>(); c.Property(x => x.SelectionMethod).HasConversion<string>();
        c.Property(x => x.ExpectedContributionPerMember).HasPrecision(18, 2); c.Property(x => x.ExpectedPoolAmount).HasPrecision(18, 2); c.Property(x => x.RecordedContributionAmount).HasPrecision(18, 2);
        c.Property(x => x.Version).IsConcurrencyToken(); c.HasIndex(x => new { x.GroupId, x.CycleNumber }).IsUnique(); c.HasIndex(x => x.Status); c.HasIndex(x => x.ContributionDueDate);
        c.HasOne<Group>().WithMany().HasForeignKey(x => x.GroupId).OnDelete(DeleteBehavior.Restrict);
        model.Entity<GroupMembership>().HasAlternateKey(x => new { x.Id, x.GroupId });
        var obligation = model.Entity<Contribution>();
        obligation.ToTable("Contributions", t => t.HasCheckConstraint("CK_Contribution_Amounts", "\"ExpectedAmount\" > 0 AND \"RecordedAmount\" BETWEEN 0 AND \"ExpectedAmount\""));
        obligation.HasKey(x => x.Id); obligation.Property(x => x.Status).HasConversion<string>(); obligation.Property(x => x.ExpectedAmount).HasPrecision(18, 2); obligation.Property(x => x.RecordedAmount).HasPrecision(18, 2); obligation.Property(x => x.Version).IsConcurrencyToken();
        obligation.HasIndex(x => new { x.CycleId, x.MembershipId }).IsUnique(); obligation.HasIndex(x => x.MembershipId); obligation.HasIndex(x => new { x.Status, x.DueDate }); obligation.HasIndex(x => x.DueDate);
        obligation.HasOne<MonthlyCycle>().WithMany().HasForeignKey(x => new { x.CycleId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        obligation.HasOne<GroupMembership>().WithMany().HasForeignKey(x => new { x.MembershipId, x.GroupId }).HasPrincipalKey(x => new { x.Id, x.GroupId }).OnDelete(DeleteBehavior.Restrict);
        var entry = model.Entity<ContributionEntry>();
        entry.ToTable("ContributionEntries", t => {
            t.HasCheckConstraint("CK_Entry_Amount", "\"Amount\" > 0");
            t.HasCheckConstraint("CK_Entry_Reversal", "(\"EntryType\" = 'Record' AND \"ReversesEntryId\" IS NULL) OR (\"EntryType\" = 'Reversal' AND \"ReversesEntryId\" IS NOT NULL)");
        });
        entry.HasKey(x => x.Id); entry.HasAlternateKey(x => new { x.Id, x.ContributionId }); entry.Property(x => x.EntryType).HasConversion<string>(); entry.Property(x => x.Amount).HasPrecision(18, 2);
        entry.Property(x => x.Reference).HasMaxLength(200); entry.Property(x => x.IdempotencyKey).HasMaxLength(200); entry.Property(x => x.Note).HasMaxLength(1000);
        entry.HasIndex(x => new { x.ContributionId, x.IdempotencyKey }).IsUnique(); entry.HasIndex(x => new { x.ContributionId, x.Reference }).IsUnique().HasFilter("\"EntryType\" = 'Record'"); entry.HasIndex(x => x.Reference);
        entry.HasIndex(x => x.ReversesEntryId).IsUnique().HasFilter("\"ReversesEntryId\" IS NOT NULL");
        entry.HasOne<Contribution>().WithMany().HasForeignKey(x => x.ContributionId).OnDelete(DeleteBehavior.Restrict);
        entry.HasOne<ContributionEntry>().WithMany().HasForeignKey(x => new { x.ReversesEntryId, x.ContributionId }).HasPrincipalKey(x => new { x.Id, x.ContributionId }).OnDelete(DeleteBehavior.Restrict);
        var receipt = model.Entity<IdempotencyRecord>(); receipt.ToTable("IdempotencyRecords"); receipt.HasKey(x => x.Id);
        receipt.Property(x => x.Scope).HasMaxLength(100); receipt.Property(x => x.Key).HasMaxLength(200); receipt.Property(x => x.RequestHash).HasMaxLength(64);
        receipt.HasIndex(x => new { x.Scope, x.Key }).IsUnique();
    }
}
